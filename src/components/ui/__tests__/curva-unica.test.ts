// La curva del proyecto se escribe en un solo lugar.
//
// `[0.16, 1, 0.3, 1]` es --ease-out (globals.css) y vivía copiada como
// literal en cinco archivos: el template de página, el sheet, el toast y los
// dos menús. Una curva duplicada es una curva que en algún momento deja de
// ser la misma, y el día que alguien la ajuste va a ajustar cuatro de las
// cinco copias.
//
// Este test camina los archivos que animan y falla si aparece el literal
// fuera de movimiento.tsx, que es de donde se importa. No es un test de
// comportamiento: es el guardián de una decisión, como el de los módulos de
// Node en el edge.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SUAVE } from "@/components/ui/movimiento";

const RAIZ = path.resolve(__dirname, "../../../..");

/** Donde vive la constante. Es el único archivo que puede escribirla. */
const FUENTE = "src/components/ui/movimiento.tsx";

/** Todo lo que anima con framer-motion en la app. */
const ARCHIVOS_QUE_ANIMAN = [
  FUENTE,
  "src/components/ui/sheet.tsx",
  "src/components/ui/toast.tsx",
  "src/components/ui/confirmar.tsx",
  "src/components/ui/session-row.tsx",
  "src/components/ui/plegable.tsx",
  "src/components/layout/sidebar.tsx",
  "src/components/layout/bottom-nav.tsx",
  "src/app/(dashboard)/template.tsx",
];

/** El literal, escrito como lo escribiría prettier y también sin espacios:
 *  las dos formas son la misma curva copiada. */
const LITERALES = ["[0.16, 1, 0.3, 1]", "[0.16,1,0.3,1]"];

function leer(relativo: string): string {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

describe("la curva --ease-out", () => {
  it("es la que declara globals.css", () => {
    expect([...SUAVE]).toEqual([0.16, 1, 0.3, 1]);
    expect(leer("src/app/globals.css")).toContain(
      "--ease-out: cubic-bezier(0.16, 1, 0.3, 1)",
    );
  });

  it("se escribe una sola vez, en movimiento.tsx", () => {
    const copias = ARCHIVOS_QUE_ANIMAN.filter((archivo) => {
      if (archivo === FUENTE) return false;
      const fuente = leer(archivo);
      return LITERALES.some((literal) => fuente.includes(literal));
    });

    expect(copias).toEqual([]);
  });

  it("la importa cada archivo que la usa", () => {
    for (const archivo of ARCHIVOS_QUE_ANIMAN) {
      if (archivo === FUENTE) continue;
      const fuente = leer(archivo);
      if (!fuente.includes("SUAVE")) continue;
      expect(fuente).toMatch(/import \{[\s\S]*?SUAVE[\s\S]*?\} from "[^"]*movimiento"/);
    }
  });
});
