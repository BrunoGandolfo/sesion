import { describe, expect, it } from "vitest";

import { avisoMirandoTranscripcion as aviso, MARCA_ESTADO_LUX, type RespuestaLux } from "@/lib/lux/contrato";

import { leerRespuesta } from "../respuesta";

/** La prosa de una respuesta leída, sin citas ni estados. */
const prosaDe = (r: RespuestaLux) => r.bloques.flatMap((b) => (b.tipo === "prosa" ? [b.texto] : [])).join("\n\n");

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

  it("una línea de transcripción con la marca del servidor es un estado", () => {
    const r = leerRespuesta(`Dejame ver.\n${aviso("03/10")}\nAhí dice que no durmió.\n${aviso("7/9")}`, true);
    expect(r.bloques).toEqual([
      { tipo: "prosa", texto: "Dejame ver." },
      { tipo: "estado", fecha: "03/10" },
      { tipo: "prosa", texto: "Ahí dice que no durmió." },
      { tipo: "estado", fecha: "7/9" },
    ]);
    expect(prosaDe(r)).toBe("Dejame ver.\n\nAhí dice que no durmió.");
  });

  it("la misma línea sin la marca (el modelo imitándola) es prosa común", () => {
    const r = leerRespuesta("Dejame ver.\n_(mirando la transcripción del 03/10)_\n(mirando la transcripción del 7/9)", true);
    expect(r.bloques.every((b) => b.tipo === "prosa")).toBe(true);
    expect(prosaDe(r)).toContain("(mirando la transcripción del 03/10)");
    expect(prosaDe(r)).toContain("(mirando la transcripción del 7/9)");
    // Y mientras llega no se esconde: no puede ser un estado.
    expect(prosaDe(leerRespuesta("Dejame ver.\n_(mirando la trans", false))).toContain("(mirando la trans");
  });

  it("no deja asomar una línea de estado a medio llegar", () => {
    const aMedias = `Dejame ver.\n${MARCA_ESTADO_LUX}_(mirando la trans`;
    expect(leerRespuesta(aMedias, false).bloques).toEqual([
      { tipo: "prosa", texto: "Dejame ver." },
    ]);
    // Al terminar el stream, lo que quedó se muestra como vino, sin la marca.
    const final = prosaDe(leerRespuesta(aMedias, true));
    expect(final).toContain("(mirando la trans");
    expect(final).not.toContain(MARCA_ESTADO_LUX);
  });

  it("limpia el Markdown como la ayuda", () => {
    expect(prosaDe(leerRespuesta("## Resumen\nHabló **mucho** de `trabajo`.", true))).toBe("Resumen\nHabló mucho de trabajo.");
  });

  it("sin citas, citas es null; unas citas vacías también", () => {
    expect(leerRespuesta("Hola.", true).citas).toBeNull();
    expect(leerRespuesta("<citas> </citas>Hola.", true).citas).toBeNull();
  });

  it("las citas después de abrir una transcripción también se pliegan y no vuelven como prosa", () => {
    // Lo que manda el servidor cuando Lux usa leer_transcripcion: preámbulo,
    // aviso y recién ahí la respuesta, que empieza con sus citas.
    const crudo = `Voy a mirar esa sesión.\n\n${aviso("03/10")}\n\n<citas>\nSesión del 03/10: "me fui antes"\n</citas>\nAhí aparece otra vez el irse antes.`;
    const r = leerRespuesta(crudo, true);
    expect(r.citas).toBe("Sesión del 03/10: \"me fui antes\"");
    expect(r.bloques).toEqual([
      { tipo: "prosa", texto: "Voy a mirar esa sesión." },
      { tipo: "estado", fecha: "03/10" },
      { tipo: "prosa", texto: "Ahí aparece otra vez el irse antes." },
    ]);
    expect(prosaDe(r)).not.toContain("citas");
    // A medio llegar, las citas de la segunda ronda tampoco asoman.
    const parcial = leerRespuesta(`Voy a mirar esa sesión.\n\n${aviso("03/10")}\n\n<citas>\nSesión del`, false);
    expect(parcial.citas).toBeNull();
    expect(parcial.bloques).toEqual([
      { tipo: "prosa", texto: "Voy a mirar esa sesión." },
      { tipo: "estado", fecha: "03/10" },
    ]);
    expect(leerRespuesta("Voy a mirar.\n<ci", false).bloques).toEqual([{ tipo: "prosa", texto: "Voy a mirar." }]);
  });

  it("dos bloques de citas se juntan", () => {
    expect(leerRespuesta("<citas>A</citas>\nUno.\n<citas>B</citas>\nDos.", true).citas).toBe("A\nB");
  });
});

