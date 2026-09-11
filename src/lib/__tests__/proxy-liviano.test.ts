// Guardián del proxy: importa SOLO @/lib/csp y @/lib/sesion-cookie, y ningún
// módulo de Node en toda la cadena. Reemplaza a middleware-edge.test.ts.
//
// POR QUÉ
//
// El proxy corre en Node (Next 16), así que `node:*` ya no rompe el deploy.
// Lo que sí rompe es lo que el guardián viejo no miraba: un proxy que
// arrastre la base, la autenticación o un módulo pesado hace una consulta
// por request para todos los estáticos y prefetches, y no puede caer sin
// tirar la app entera. La regla (AGENTS.md, 9) es que el grafo de imports
// desde src/proxy.ts sea EXACTAMENTE el conjunto de abajo. Un archivo nuevo
// en la cadena se discute acá, no se descubre en producción.
//
// Además se conserva la prohibición de built-ins de Node en esa cadena: los
// dos módulos permitidos son puros y tienen que seguir siéndolo (Web Crypto
// para el nonce, nada de fs, path ni crypto).

import { readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ENTRADA = "src/proxy.ts";

/** El grafo completo permitido, relativo a la raíz del repo. */
const PERMITIDOS = ["src/proxy.ts", "src/lib/csp.ts", "src/lib/sesion-cookie.ts"];

const RAIZ = process.cwd();
const SRC = resolve(RAIZ, "src");
const EXTENSIONES = [".ts", ".tsx", ".mts", ".js", ".jsx"];

const BUILT_INS: ReadonlySet<string> = new Set(
  builtinModules.map((n) => (n.startsWith("node:") ? n.slice(5) : n)),
);

export function esModuloDeNode(especificador: string): boolean {
  if (especificador.startsWith("node:")) return true;
  return BUILT_INS.has(especificador);
}

function sinComentarios(fuente: string): string {
  return fuente
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const ESTATICO = /(?:^|[\s;])(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DINAMICO = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SOLO_EFECTO = /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;

export function especificadores(fuente: string): string[] {
  const limpia = sinComentarios(fuente);
  const out: string[] = [];
  for (const regex of [ESTATICO, DINAMICO, SOLO_EFECTO]) {
    for (const m of limpia.matchAll(regex)) out.push(m[1]);
  }
  return out;
}

function esArchivo(ruta: string): boolean {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
}

function resolverLocal(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = resolve(dirname(desde), especificador);
  else return null;
  for (const ext of EXTENSIONES) if (esArchivo(base + ext)) return base + ext;
  for (const ext of EXTENSIONES) {
    const indice = join(base, `index${ext}`);
    if (esArchivo(indice)) return indice;
  }
  return esArchivo(base) ? base : null;
}

interface Hallazgo { archivo: string; modulo: string; cadena: string[] }

function recorrerCadena(): { archivos: string[]; hallazgos: Hallazgo[]; paquetes: string[] } {
  const entrada = resolve(RAIZ, ENTRADA);
  const vistos = new Set<string>([entrada]);
  const hallazgos: Hallazgo[] = [];
  const paquetes = new Set<string>();
  const pendientes = [{ archivo: entrada, cadena: [ENTRADA] }];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    const fuente = readFileSync(actual.archivo, "utf8");
    for (const esp of especificadores(fuente)) {
      if (esModuloDeNode(esp)) {
        hallazgos.push({ archivo: actual.archivo.slice(RAIZ.length + 1), modulo: esp, cadena: actual.cadena });
        continue;
      }
      const destino = resolverLocal(actual.archivo, esp);
      if (!destino) {
        paquetes.add(esp);
        continue;
      }
      if (vistos.has(destino)) continue;
      vistos.add(destino);
      pendientes.push({ archivo: destino, cadena: [...actual.cadena, destino.slice(RAIZ.length + 1)] });
    }
  }
  return { archivos: [...vistos].map((a) => a.slice(RAIZ.length + 1)), hallazgos, paquetes: [...paquetes] };
}

describe("el proxy es liviano", () => {
  it("su grafo de imports locales es exactamente proxy, csp y sesion-cookie", () => {
    expect(recorrerCadena().archivos.sort()).toEqual([...PERMITIDOS].sort());
  });

  it("de paquetes solo usa next/server", () => {
    expect(recorrerCadena().paquetes).toEqual(["next/server"]);
  });

  it("no alcanza ningún built-in de Node (los dos módulos son puros)", () => {
    const detalle = recorrerCadena().hallazgos.map(
      (h) => `${h.archivo} importa ${h.modulo} — vía ${h.cadena.join(" → ")}`,
    );
    expect(detalle).toEqual([]);
  });

  it("no alcanza la base, la autenticación ni el correo", () => {
    const archivos = recorrerCadena().archivos;
    for (const prohibido of [
      "src/lib/db.ts", "src/lib/prisma-encryption.ts", "src/lib/encryption.ts", "src/lib/llavero.ts",
      "src/lib/sesion-acceso.ts", "src/app/api/_lib/auth.ts", "src/lib/correo.ts", "src/lib/glosario.ts",
    ]) {
      expect(archivos).not.toContain(prohibido);
    }
  });
});

describe("el detector, a solas", () => {
  it("reconoce built-ins con y sin prefijo y sus sub-paths", () => {
    expect(esModuloDeNode("node:crypto")).toBe(true);
    expect(esModuloDeNode("crypto")).toBe(true);
    expect(esModuloDeNode("fs/promises")).toBe(true);
    expect(esModuloDeNode("next/server")).toBe(false);
    expect(esModuloDeNode("@/lib/csp")).toBe(false);
  });

  it("lee las formas de import que usa el repo y salta los comentarios", () => {
    expect(especificadores(`import { a } from "crypto";\nexport { b } from "./x";\nconst c = await import("bcryptjs");\nimport "./e.css";`)).toEqual([
      "crypto", "./x", "bcryptjs", "./e.css",
    ]);
    expect(especificadores(`// import { createHash } from "crypto";`)).toEqual([]);
  });
});
