// Guardián del bundle edge del middleware.
//
// POR QUÉ EXISTE
//
// El PR #11 pasó CI entero (typecheck, build, lint, tests) y el deploy de
// producción falló igual al empaquetar la Edge Function:
//
//   The Edge Function "_middleware" is referencing unsupported modules:
//     - __vc__ns__/0/index.js: node:crypto
//
// El culpable era `src/lib/login-eventos.ts`, que importaba `node:crypto`
// para hashear el email. Nadie lo vio porque ese módulo NO lo importa el
// middleware de forma directa: lo importa `src/lib/auth.ts` con un
// `await import(...)` adentro de `authorize()`, que nunca corre en el
// middleware. Da igual: el empaquetador sigue el import dinámico y lo mete
// en el bundle edge, y `node:*` ahí no existe.
//
// `next build` no lo detecta —el error aparece recién del lado de Vercel— y
// un chequeo que dependa de credenciales de Vercel no sirve como guardián de
// PR. Así que el guardián camina el grafo de imports acá.
//
// POR QUÉ UN TEST Y NO UNA REGLA DE ESLINT
//
// `no-restricted-imports` con `files: [...]` obliga a mantener a mano la
// lista de archivos de la cadena. La cadena es justamente lo que nadie tenía
// en la cabeza el día del error: si mañana `login-eventos.ts` importa un
// módulo nuevo, hay que acordarse de agregarlo a la lista de eslint.config,
// y si uno se olvida el guardián calla. Este test DESCUBRE la cadena en vez
// de declararla: sale de `src/middleware.ts` y sigue todo import local,
// estático o dinámico. Un archivo nuevo queda cubierto solo.
//
// EL PREFIJO `node:` NO ALCANZA (Codex P2 sobre el PR #12)
//
// `import { createHash } from "crypto"` es tan válido como
// `from "node:crypto"` y rompe el Edge exactamente igual. La primera versión
// de este guardián sólo miraba el prefijo: un especificador pelado como
// "crypto", "fs" o "path" no era "node:*", `resolverLocal()` lo trataba como
// un paquete de node_modules y lo descartaba en silencio. Pasaba en verde y
// el deploy volvía a reventar.
//
// La lista de built-ins no se escribe a mano: sale de `builtinModules` de
// `node:module`, que es la lista real del runtime que corre el test. Incluye
// los sub-paths ("fs/promises", "stream/web", "timers/promises"), así que un
// `import { readFile } from "fs/promises"` también se atrapa.
//
// LÍMITES (dichos a propósito)
//
//   - Sigue únicamente imports de primera mano (`@/…`, `./…`, `../…`). Un
//     paquete de node_modules que arrastre `node:*` no se ve desde acá; eso
//     lo tapa el propio empaquetador de Next, que sí resuelve node_modules.
//   - Lee los imports con expresiones regulares, no con un AST. Cubre las
//     formas que el repositorio usa (import, import type, export … from,
//     import() dinámico, import de solo efecto). Un `require()` o un
//     especificador armado en una variable se le escapan.
//   - Un paquete de npm que se llame igual que un built-in ("crypto",
//     "punycode", "querystring" existen en el registro como polyfills) daría
//     un falso positivo. Es el intercambio correcto: un falso positivo se
//     discute en el PR, un falso negativo se descubre en producción.

import { readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Entrada de la Edge Function que Vercel llama "_middleware". */
const ENTRADA = "src/middleware.ts";

const RAIZ = process.cwd();
const SRC = resolve(RAIZ, "src");

const EXTENSIONES = [".ts", ".tsx", ".mts", ".js", ".jsx"];

/**
 * Todos los módulos built-in del runtime, con y sin prefijo. `builtinModules`
 * los devuelve mayormente pelados ("fs", "fs/promises") y algunos sólo con
 * prefijo ("node:test", "node:sqlite"); se normaliza para poder consultar por
 * cualquiera de las dos formas.
 */
const BUILT_INS: ReadonlySet<string> = new Set(
  builtinModules.map((nombre) =>
    nombre.startsWith("node:") ? nombre.slice(5) : nombre,
  ),
);

/**
 * ¿Este especificador es un módulo de Node? Cubre las dos formas —"node:fs"
 * y "fs"— y los sub-paths ("fs/promises").
 *
 * Cualquier cosa con prefijo `node:` cuenta aunque no esté en la lista: si
 * mañana Node agrega `node:loquesea`, el Edge tampoco lo va a tener, y quien
 * escribió el prefijo declaró su intención de usar Node.
 */
export function esModuloDeNode(especificador: string): boolean {
  if (especificador.startsWith("node:")) return true;
  return BUILT_INS.has(especificador);
}

/**
 * Quita las líneas que son solo comentario. Alcanza para que un import
 * comentado no cuente como import, sin romper las URLs que viven adentro de
 * un string (un `//` a mitad de línea no se toca).
 */
function sinComentarios(fuente: string): string {
  return fuente
    .split("\n")
    .filter((linea) => {
      const t = linea.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const ESTATICO =
  /(?:^|[\s;])(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
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

/**
 * Resuelve un especificador local a una ruta de archivo, o `null` si no es
 * local (paquete de node_modules) o si no existe ningún archivo detrás.
 */
function resolverLocal(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) {
    base = join(SRC, especificador.slice(2));
  } else if (especificador.startsWith(".")) {
    base = resolve(dirname(desde), especificador);
  } else {
    return null;
  }

  for (const ext of EXTENSIONES) {
    if (esArchivo(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONES) {
    const indice = join(base, `index${ext}`);
    if (esArchivo(indice)) return indice;
  }
  return esArchivo(base) ? base : null;
}

interface Hallazgo {
  /** Ruta relativa a la raíz del repo del archivo que importa `node:*`. */
  archivo: string;
  modulo: string;
  /** Cómo se llega desde el middleware hasta ese archivo. */
  cadena: string[];
}

/** Camina el grafo desde `ENTRADA` y devuelve los `node:*` que encuentra. */
function recorrerCadena(): { archivos: string[]; hallazgos: Hallazgo[] } {
  const entrada = resolve(RAIZ, ENTRADA);
  const vistos = new Set<string>([entrada]);
  const hallazgos: Hallazgo[] = [];
  const pendientes: { archivo: string; cadena: string[] }[] = [
    { archivo: entrada, cadena: [ENTRADA] },
  ];

  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (!actual) break;

    const fuente = readFileSync(actual.archivo, "utf8");
    for (const especificador of especificadores(fuente)) {
      if (esModuloDeNode(especificador)) {
        hallazgos.push({
          archivo: actual.archivo.slice(RAIZ.length + 1),
          modulo: especificador,
          cadena: actual.cadena,
        });
        continue;
      }

      const destino = resolverLocal(actual.archivo, especificador);
      if (!destino || vistos.has(destino)) continue;
      vistos.add(destino);
      pendientes.push({
        archivo: destino,
        cadena: [...actual.cadena, destino.slice(RAIZ.length + 1)],
      });
    }
  }

  return { archivos: [...vistos], hallazgos };
}

describe("cadena de imports del middleware", () => {
  it("no alcanza ningún módulo node:* (el runtime edge no los tiene)", () => {
    const { hallazgos } = recorrerCadena();

    const detalle = hallazgos.map(
      (h) => `${h.archivo} importa ${h.modulo} — vía ${h.cadena.join(" → ")}`,
    );

    expect(detalle).toEqual([]);
  });

  it("recorre de verdad la cadena, incluidos los imports dinámicos", () => {
    // Si el guardián dejara de encontrar los archivos que sabemos que están
    // en la cadena, pasaría en verde sin haber mirado nada. `login-eventos`
    // solo se alcanza por el `await import()` de authorize(): es el caso que
    // el guardián existe para cubrir.
    const { archivos } = recorrerCadena();
    const relativos = archivos.map((a) => a.slice(RAIZ.length + 1));

    expect(relativos).toContain("src/lib/auth.ts");
    expect(relativos).toContain("src/lib/login-eventos.ts");
    expect(relativos).toContain("src/lib/crypto.ts");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// El detector, a solas
//
// Los tests de arriba pasan en verde también si el detector no detecta nada
// (hoy la cadena está limpia, así que "cero hallazgos" es el resultado
// correcto y el esperado). Sin estos casos, un guardián roto se ve idéntico a
// un guardián que funciona. Acá se le dan fuentes sintéticas con la respuesta
// conocida.
// ────────────────────────────────────────────────────────────────────────────

/** Los especificadores de una fuente que el guardián marcaría como Node. */
function deteccionesEn(fuente: string): string[] {
  return especificadores(fuente).filter(esModuloDeNode);
}

describe("esModuloDeNode", () => {
  it("reconoce las dos formas del mismo módulo", () => {
    expect(esModuloDeNode("node:crypto")).toBe(true);
    expect(esModuloDeNode("crypto")).toBe(true);
  });

  it("reconoce los sub-paths de los built-in", () => {
    expect(esModuloDeNode("fs/promises")).toBe(true);
    expect(esModuloDeNode("node:fs/promises")).toBe(true);
  });

  it("acepta cualquier cosa con prefijo node:, aunque no exista todavía", () => {
    expect(esModuloDeNode("node:modulo-que-node-agregue-manana")).toBe(true);
  });

  it("no marca paquetes ni rutas de la app", () => {
    for (const especificador of [
      "bcryptjs",
      "next/server",
      "next-auth/providers/credentials",
      "@prisma/client",
      "@/lib/crypto",
      "./responses",
      "../../_lib/auth",
    ]) {
      expect(esModuloDeNode(especificador)).toBe(false);
    }
  });

  it("la lista de built-in salió del runtime y tiene lo que tiene que tener", () => {
    // Si `builtinModules` se leyera mal, BUILT_INS quedaría vacío y todo el
    // guardián pasaría en verde sin mirar nada.
    for (const nombre of ["crypto", "fs", "path", "buffer", "os", "stream"]) {
      expect(esModuloDeNode(nombre)).toBe(true);
    }
  });
});

describe("el guardián detecta las cuatro formas de import", () => {
  // Un caso positivo (built-in sin prefijo, que es el que se escapaba) y uno
  // negativo (un paquete de npm) por cada forma que el repositorio usa.

  it("import estático", () => {
    expect(deteccionesEn(`import { createHash } from "crypto";`)).toEqual([
      "crypto",
    ]);
    expect(deteccionesEn(`import bcrypt from "bcryptjs";`)).toEqual([]);
  });

  it("import de tipo y multilínea", () => {
    expect(
      deteccionesEn(`import type {\n  Stats,\n} from "fs";`),
    ).toEqual(["fs"]);
    expect(
      deteccionesEn(`import type {\n  Prisma,\n} from "@prisma/client";`),
    ).toEqual([]);
  });

  it("export … from", () => {
    expect(deteccionesEn(`export { join } from "path";`)).toEqual(["path"]);
    expect(deteccionesEn(`export { hora } from "@/lib/format";`)).toEqual([]);
  });

  it("import() dinámico", () => {
    expect(deteccionesEn(`const c = await import("crypto");`)).toEqual([
      "crypto",
    ]);
    expect(deteccionesEn(`const b = await import("bcryptjs");`)).toEqual([]);
  });

  it("import de solo efecto", () => {
    expect(deteccionesEn(`import "os";`)).toEqual(["os"]);
    expect(deteccionesEn(`import "./estilos.css";`)).toEqual([]);
  });

  it("un import comentado no cuenta", () => {
    expect(deteccionesEn(`// import { createHash } from "crypto";`)).toEqual(
      [],
    );
  });

  it("un módulo nombrado en prosa no cuenta", () => {
    // El propio auth.ts tiene un comentario que dice "node:crypto".
    expect(
      deteccionesEn(`// OJO: no importar node:crypto acá, revienta el edge.`),
    ).toEqual([]);
  });
});
