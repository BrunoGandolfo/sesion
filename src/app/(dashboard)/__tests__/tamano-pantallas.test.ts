// Guardián del tamaño de las pantallas: ningún archivo pasa de 450 líneas.
//
// POR QUÉ EXISTE
//
// A fines de la ola 2 había doce archivos de pantalla por encima de 450
// líneas, el mayor con más de mil. En un archivo así viven juntas la lectura
// de la red, las reglas, el estado y el JSX, y un cambio chico obliga a leer
// todo. La ola 3 los cortó con el patrón de Hoy (`_components/datos.ts`):
// lecturas y mutaciones puras en un `datos.ts`, hooks con el estado,
// componentes con la presentación.
//
// Este test impide que vuelvan a crecer. Recorre `src/app/(dashboard)`,
// `src/components` y `src/hooks` (sin tests) y falla ante cualquier `.ts` o
// `.tsx` de más de LIMITE líneas que no esté en EXCEPCIONES.
//
// EXCEPCIONES es temporal: cada entrada tiene dueño, y la entrada sale en el
// commit que corta el archivo. Una excepción que ya no hace falta también
// falla, para que la lista no quede con entradas muertas.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const LIMITE = 450;

const RAIZ = process.cwd();
const CARPETAS = ["src/app/(dashboard)", "src/components", "src/hooks"];

/** Archivo (relativo a la raíz) → dueño del corte pendiente. */
const EXCEPCIONES: Record<string, string> = {
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

function lineas(ruta: string): number {
  // Igual que `wc -l`: cuenta saltos de línea.
  return readFileSync(ruta, "utf8").split("\n").length - 1;
}

const medidos = CARPETAS.flatMap((carpeta) => archivos(join(RAIZ, carpeta)))
  .map((ruta) => relative(RAIZ, ruta))
  .filter((ruta) => !esTest(ruta))
  .map((ruta) => ({ ruta, lineas: lineas(join(RAIZ, ruta)) }));

describe(`tamaño de las pantallas (máximo ${LIMITE} líneas)`, () => {
  it("encuentra los archivos que mide", () => {
    expect(medidos.length).toBeGreaterThan(100);
  });

  it("ningún archivo fuera de EXCEPCIONES pasa del límite", () => {
    const grandes = medidos
      .filter((m) => m.lineas > LIMITE && !(m.ruta in EXCEPCIONES))
      .map((m) => `${m.ruta}: ${m.lineas} líneas`);
    expect(
      grandes,
      `Cortalo con el patrón de Hoy (_components/datos.ts): lecturas puras en datos.ts, hooks con el estado, componentes con la presentación.`,
    ).toEqual([]);
  });

  it("cada excepción sigue haciendo falta", () => {
    const sobran = Object.keys(EXCEPCIONES).filter((ruta) => {
      const medido = medidos.find((m) => m.ruta === ruta);
      return !medido || medido.lineas <= LIMITE;
    });
    expect(sobran, "Ya está por debajo del límite (o no existe): sacala de EXCEPCIONES.").toEqual([]);
  });
});
