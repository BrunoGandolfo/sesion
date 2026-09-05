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
// LÍMITES (dichos a propósito)
//
//   - Sigue únicamente imports de primera mano (`@/…`, `./…`, `../…`). Un
//     paquete de node_modules que arrastre `node:*` no se ve desde acá; eso
//     lo tapa el propio empaquetador de Next, que sí resuelve node_modules.
//   - Lee los imports con expresiones regulares, no con un AST. Cubre las
//     formas que el repositorio usa (import, import type, export … from,
//     import() dinámico, import de solo efecto). Un `require()` o un
//     especificador armado en una variable se le escapan.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Entrada de la Edge Function que Vercel llama "_middleware". */
const ENTRADA = "src/middleware.ts";

const RAIZ = process.cwd();
const SRC = resolve(RAIZ, "src");

const EXTENSIONES = [".ts", ".tsx", ".mts", ".js", ".jsx"];

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

function especificadores(fuente: string): string[] {
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
      if (especificador.startsWith("node:")) {
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
