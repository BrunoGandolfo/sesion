// Una navegación dura un solo número.
//
// Cuando ella toca el menú arrancan dos movimientos a la vez: el subrayado
// que viaja a la pestaña nueva (bottom-nav.tsx, y la barra vertical
// equivalente de sidebar.tsx) y el fundido con el que entra la pantalla
// (template.tsx). Eran 260 y 180 ms escritos como literales en cada archivo,
// así que terminaban en momentos distintos y la pantalla se asentaba dos
// veces.
//
// Este test es el guardián de esa decisión, como curva-unica.test.ts lo es
// de --ease-out: no prueba comportamiento, prueba que el número no vuelva a
// estar escrito en dos lados.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DURACION_NAVEGACION, MS_NAVEGACION } from "@/components/ui/movimiento";

const RAIZ = path.resolve(__dirname, "../../../..");

/** Donde vive la constante. Es el único archivo que puede escribir el número. */
const FUENTE = "src/components/ui/movimiento.tsx";

const ARCHIVOS_DE_NAVEGACION = [
  "src/app/(dashboard)/template.tsx",
  "src/components/layout/bottom-nav.tsx",
  "src/components/layout/sidebar.tsx",
];

/** El número, en las dos unidades y escrito como lo escribiría prettier. */
const LITERALES = ["0.26", "260", "0.18", "180"];

function leer(relativo: string): string {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

/** El código sin sus comentarios. Los archivos de este proyecto explican por
 *  qué el número es el que es, y esa explicación cita los milisegundos: lo
 *  que no puede aparecer es el número EJECUTÁNDOSE en dos lados. */
function codigoDe(relativo: string): string {
  return leer(relativo)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("la duración de una navegación", () => {
  it("es un solo número, en milisegundos y en segundos", () => {
    expect(MS_NAVEGACION).toBe(260);
    expect(DURACION_NAVEGACION).toBe(0.26);
    // La conversión no se escribe a mano en ningún lado.
    expect(DURACION_NAVEGACION).toBe(MS_NAVEGACION / 1000);
  });

  it("iguala al subrayado del menú, que es el más largo de los dos", () => {
    // Si algún día el subrayado cambia de duración, este número lo sigue.
    // Lo que no puede volver a pasar es que sean dos.
    expect(MS_NAVEGACION).toBeGreaterThanOrEqual(180);
  });

  it("se escribe una sola vez, en movimiento.tsx", () => {
    const copias = ARCHIVOS_DE_NAVEGACION.filter((archivo) => {
      if (archivo === FUENTE) return false;
      const fuente = codigoDe(archivo);
      return LITERALES.some((literal) => fuente.includes(literal));
    });

    expect(copias).toEqual([]);
  });

  it("la importa cada archivo que la usa", () => {
    for (const archivo of ARCHIVOS_DE_NAVEGACION) {
      if (archivo === FUENTE) continue;
      expect(leer(archivo)).toMatch(
        /import \{[\s\S]*?DURACION_NAVEGACION[\s\S]*?\} from "[^"]*movimiento"/,
      );
    }
  });
});
