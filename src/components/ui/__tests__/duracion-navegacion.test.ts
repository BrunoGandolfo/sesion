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

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TIEMPOS, VARIABLES_MOVIMIENTO } from "@/lib/movimiento";
import { DURACION_NAVEGACION, DURACION_BREVE, DURACION_PANEL } from "@/components/ui/movimiento";

const RAIZ = path.resolve(__dirname, "../../../..");

/** Donde vive la constante. Es el único archivo que puede escribir el número. */
const FUENTE = "src/lib/movimiento.ts";

/** El número usado como duración, en ms o en segundos: `duration: 0.18`,
 *  `duration-[180ms]`, `"180ms"`. Solo en ese contexto: 180 a secas también
 *  es un giro de flecha o seis meses de agenda. */
const COMO_DURACION = new RegExp(
  [TIEMPOS.navegacion, TIEMPOS.navegacion / 1000]
    .map((n) => String(n).replace(".", "\\."))
    .flatMap((n) => [`duration\\W{0,4}${n}\\b`, `\\b${n}m?s\\b`])
    .join("|"),
);

/** Todo el código de la app, sin los tests. */
function fuentesDe(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((nombre) => {
    const relativo = path.join(dir, nombre);
    if (statSync(path.join(RAIZ, relativo)).isDirectory()) {
      return nombre === "__tests__" ? [] : fuentesDe(relativo);
    }
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre) ? [relativo] : [];
  });
}

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
  it("el detector reconoce el número escrito como duración", () => {
    for (const copia of ["duration: 0.18", "duration-[180ms]", 'transition: "opacity 180ms"', "{ duration: 180 }"]) {
      expect(COMO_DURACION.test(copia), copia).toBe(true);
    }
    for (const otro of ['"rotate-180"', "agregarDiasMvd(ahora, -180)", "width: 180"]) {
      expect(COMO_DURACION.test(otro), otro).toBe(false);
    }
  });

  it("se escribe una sola vez, en lib/movimiento.ts", () => {
    const copias = fuentesDe("src").filter(
      (archivo) => archivo !== FUENTE && COMO_DURACION.test(codigoDe(archivo)),
    );

    expect(copias).toEqual([]);
  });
});

it("respeta los tiempos aprobados por el dueño y los publica igual en JS y CSS", () => {
  // Contrato aprobado el 15/09/2026. Cambiar estos valores requiere una decisión
  // del dueño; derivar también la expectativa escondería una modificación.
  expect(TIEMPOS).toEqual({ breve: 150, navegacion: 180, pliegue: 220 });
  expect(DURACION_BREVE).toBe(TIEMPOS.breve / 1000);
  expect(DURACION_NAVEGACION).toBe(TIEMPOS.navegacion / 1000);
  expect(DURACION_PANEL).toBe(TIEMPOS.pliegue / 1000);
  expect(VARIABLES_MOVIMIENTO["--duration-fast"]).toBe(TIEMPOS.breve + "ms");
  expect(VARIABLES_MOVIMIENTO["--duration-normal"]).toBe(TIEMPOS.navegacion + "ms");
  expect(VARIABLES_MOVIMIENTO["--duration-pliegue"]).toBe(TIEMPOS.pliegue + "ms");
});
