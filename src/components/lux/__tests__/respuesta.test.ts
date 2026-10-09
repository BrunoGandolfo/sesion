import { describe, expect, it } from "vitest";

import { leerRespuesta, prosaDe } from "../respuesta";

describe("leerRespuesta", () => {
  it("separa las citas del principio y deja la prosa", () => {
    const r = leerRespuesta("<citas>Nota del 03/10\nRecorrido vigente</citas>\nLa última vez habló de su hermana.", true);
    expect(r.citas).toBe("Nota del 03/10\nRecorrido vigente");
    expect(r.bloques).toEqual([{ tipo: "prosa", texto: "La última vez habló de su hermana." }]);
  });

  it("mientras las citas no se cierran no muestra nada, tampoco el comienzo de la etiqueta", () => {
    expect(leerRespuesta("<ci", false)).toEqual({ citas: null, bloques: [] });
    expect(leerRespuesta("<citas>Nota del 0", false)).toEqual({ citas: null, bloques: [] });
  });

  it("una línea de transcripción es un estado, con o sin los guiones bajos", () => {
    const r = leerRespuesta("Dejame ver.\n_(mirando la transcripción del 03/10)_\nAhí dice que no durmió.\n(mirando la transcripción del 7/9)", true);
    expect(r.bloques).toEqual([
      { tipo: "prosa", texto: "Dejame ver." },
      { tipo: "estado", fecha: "03/10" },
      { tipo: "prosa", texto: "Ahí dice que no durmió." },
      { tipo: "estado", fecha: "7/9" },
    ]);
    expect(prosaDe(r)).toBe("Dejame ver.\n\nAhí dice que no durmió.");
  });

  it("no deja asomar una línea de estado a medio llegar", () => {
    expect(leerRespuesta("Dejame ver.\n_(mirando la trans", false).bloques).toEqual([
      { tipo: "prosa", texto: "Dejame ver." },
    ]);
    // Al terminar el stream, lo que quedó se muestra como vino.
    expect(prosaDe(leerRespuesta("Dejame ver.\n_(mirando la trans", true))).toContain("(mirando la trans");
  });

  it("limpia el Markdown como la ayuda", () => {
    expect(prosaDe(leerRespuesta("## Resumen\nHabló **mucho** de `trabajo`.", true))).toBe("Resumen\nHabló mucho de trabajo.");
  });

  it("sin citas, citas es null; unas citas vacías también", () => {
    expect(leerRespuesta("Hola.", true).citas).toBeNull();
    expect(leerRespuesta("<citas> </citas>Hola.", true).citas).toBeNull();
  });
});
