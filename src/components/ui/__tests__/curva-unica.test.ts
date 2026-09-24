// La curva del proyecto se escribe en un solo lugar.
//
// `[0.16, 1, 0.3, 1]` es --ease-out (globals.css) y vivía copiada como
// literal en cinco archivos: el template de página, el sheet, el toast y los
// dos menús. Una curva duplicada es una curva que en algún momento deja de
// ser la misma, y el día que alguien la ajuste va a ajustar cuatro de las
// cinco copias.
//
// Este test recorre src/ y falla si aparece el literal fuera de
// lib/movimiento.ts, que es de donde se importa. No es un test de
// comportamiento: es el guardián de una decisión, como proxy-liviano.test.ts
// con los imports del proxy.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SUAVE, VARIABLES_MOVIMIENTO } from "@/lib/movimiento";

const RAIZ = path.resolve(__dirname, "../../../..");

/** Donde vive la constante. Es el único archivo que puede escribirla. */
const FUENTE = "src/lib/movimiento.ts";

/** Todo el código de la app, sin los tests (este mismo escribe el literal). */
function fuentesDe(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((nombre) => {
    const relativo = path.join(dir, nombre);
    if (statSync(path.join(RAIZ, relativo)).isDirectory()) {
      return nombre === "__tests__" ? [] : fuentesDe(relativo);
    }
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre) ? [relativo] : [];
  });
}

/** El literal, escrito como lo escribiría prettier y también sin espacios:
 *  las dos formas son la misma curva copiada. */
const LITERALES = ["[0.16, 1, 0.3, 1]", "[0.16,1,0.3,1]"];

function leer(relativo: string): string {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

describe("la curva --ease-out", () => {
  it("publica la misma curva para CSS y para Framer", () => {
    expect([...SUAVE]).toEqual([0.16, 1, 0.3, 1]);
    expect(VARIABLES_MOVIMIENTO["--ease-out"]).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(leer("src/app/layout.tsx")).toContain("style={VARIABLES_MOVIMIENTO");
    expect(leer("src/app/globals.css")).toContain("transition-timing-function: var(--ease-out)");
  });

  it("se escribe una sola vez, en lib/movimiento.ts", () => {
    const copias = fuentesDe("src").filter((archivo) => {
      if (archivo === FUENTE) return false;
      const fuente = leer(archivo);
      return LITERALES.some((literal) => fuente.includes(literal));
    });

    expect(copias).toEqual([]);
  });
});
