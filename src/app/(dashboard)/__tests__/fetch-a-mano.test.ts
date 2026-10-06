// Guardián del cliente HTTP único: las pantallas hablan con /api/** por
// src/lib/api-client.ts, no con `fetch` a mano.
//
// POR QUÉ EXISTE
//
// Cada `fetch` a mano reimplementaba un pedazo de api-client —desenvolver
// `{ data }`, leer el `error` del body, decidir qué texto ver ella— y cada
// uno lo hacía un poco distinto: "HTTP 500" en pantalla, un 409 tragado, un
// `cache` olvidado. La ola 3 los pasó todos por apiGet/apiPost/apiPatch.
//
// Este test recorre src/app, src/components y src/hooks (sin tests) y falla
// ante cualquier llamada a `fetch(` que no esté en JUSTIFICADOS. Cada entrada
// dice por qué api-client no le sirve.
//
// Fuera de este recorrido quedan, también justificados:
//   - src/lib/sesion-cliente.ts (logout): vive en lib, no en una pantalla;
//   - el PUT del audio a R2 (src/lib/subida-audio.ts): es un XMLHttpRequest,
//     porque fetch no expone el progreso de subida, y no va a /api/**.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const CARPETAS = ["src/app", "src/components", "src/hooks"];

/** Archivo → por qué no usa api-client. Una llamada por archivo. */
const JUSTIFICADOS: Record<string, string> = {
  "src/components/ayuda/panel-ayuda.tsx":
    "lee la respuesta como stream (res.body) a medida que llega; api-client espera el JSON entero",
  "src/components/layout/aviso-version.tsx":
    "consulta /api/version con su propio timeout y sin mostrar errores; no es una lectura de datos de ella",
};

function esTest(ruta: string): boolean {
  return /(^|\/)__tests__\//.test(ruta) || /\.test\.tsx?$/.test(ruta);
}

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** `fetch(` como llamada: ni `refetch(`, ni `prefetch(`, ni `x.fetch(`. */
const LLAMADA_A_FETCH = /(?<![\w.$])fetch\s*\(/g;

/** Las llamadas a fetch del código (sin contar comentarios de línea). */
function llamadas(ruta: string): number {
  return readFileSync(ruta, "utf8")
    .split("\n")
    .map((linea) => linea.replace(/^\s*(\/\/|\*).*$/, ""))
    .reduce((total, linea) => total + (linea.match(LLAMADA_A_FETCH)?.length ?? 0), 0);
}

const conFetch = CARPETAS.flatMap((carpeta) => archivos(join(RAIZ, carpeta)))
  .map((ruta) => relative(RAIZ, ruta))
  .filter((ruta) => !esTest(ruta))
  .map((ruta) => ({ ruta, llamadas: llamadas(join(RAIZ, ruta)) }))
  .filter((archivo) => archivo.llamadas > 0);

describe("fetch a mano en pantallas, componentes y hooks", () => {
  it("solo quedan los justificados", () => {
    expect(
      conFetch.map((a) => a.ruta).filter((ruta) => !(ruta in JUSTIFICADOS)),
      "Usá apiGet/apiPost/apiPatch/apiDelete de @/lib/api-client. Si de verdad no sirve, agregá el archivo a JUSTIFICADOS con el motivo.",
    ).toEqual([]);
  });

  it("cada justificado hace una sola llamada y sigue haciéndola", () => {
    const porArchivo = Object.fromEntries(conFetch.map((a) => [a.ruta, a.llamadas]));
    for (const ruta of Object.keys(JUSTIFICADOS)) {
      expect(porArchivo[ruta], ruta).toBe(1);
    }
  });
});
