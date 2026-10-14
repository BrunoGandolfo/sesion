import { describe, expect, it } from "vitest";

import { leidasEnHistorial } from "@/app/api/_lib/casos-uso/lux/material";
import { avisoMirandoTranscripcion } from "@/lib/lux/contrato";

describe("las transcripciones que Lux leyó, según su historial", () => {
  it("toma las líneas 'mirando' de los turnos de Lux, sin repetir, en orden", () => {
    expect(leidasEnHistorial([
      { rol: "asistente", texto: `Voy a mirar.\n\n${avisoMirandoTranscripcion("04/08")}\n\n<citas>\nx\n</citas>\nY.` },
      { rol: "usuaria", texto: "¿Y la otra?" },
      { rol: "asistente", texto: `${avisoMirandoTranscripcion("18/08")}\nOtra.\n${avisoMirandoTranscripcion("04/08")}` },
    ])).toEqual(["04/08", "18/08"]);
  });

  it("vale con día o mes de una cifra", () => {
    expect(leidasEnHistorial([{ rol: "asistente", texto: avisoMirandoTranscripcion("4/8") }])).toEqual(["04/08"]);
  });

  it("la misma frase sin la marca del servidor (una imitación del modelo) no cuenta", () => {
    expect(leidasEnHistorial([{ rol: "asistente", texto: "Voy a mirar.\n\n_(mirando la transcripción del 04/08)_\n\n(mirando la transcripción del 18/08)" }])).toEqual([]);
  });

  it("los turnos de ella y las menciones dentro de una frase no cuentan", () => {
    expect(leidasEnHistorial([
      { rol: "usuaria", texto: avisoMirandoTranscripcion("04/08") },
      { rol: "asistente", texto: `Antes escribí ${avisoMirandoTranscripcion("04/08")} en el medio de una frase.` },
    ])).toEqual([]);
  });
});
