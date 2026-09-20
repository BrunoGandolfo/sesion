// Leer y buscar en la transcripción: las funciones puras.
import { describe, expect, it } from "vitest";

import { buscarEnBloques, leerTranscripcion } from "../transcripcion";

describe("leerTranscripcion", () => {
  it("parte el texto del worker en bloques con marca de tiempo y hablante", () => {
    const bloques = leerTranscripcion(
      "[00:03] Terapeuta: ¿Cómo estuvo la semana?\n[00:09] Paciente: Rara: dormí mal.\n[120:05] Terapeuta: Seguimos la próxima.",
    );
    expect(bloques).toEqual([
      { tipo: "turno", marca: "00:03", hablante: "Terapeuta", texto: "¿Cómo estuvo la semana?" },
      // Los dos puntos de adentro del texto son texto.
      { tipo: "turno", marca: "00:09", hablante: "Paciente", texto: "Rara: dormí mal." },
      // Una sesión larga pasa de los 99 minutos.
      { tipo: "turno", marca: "120:05", hablante: "Terapeuta", texto: "Seguimos la próxima." },
    ]);
  });

  it("una línea que no se puede interpretar se muestra entera, nunca se descarta", () => {
    const raras = ["Paciente sin marca: hola", "[xx:yy] Terapeuta: marca rota", "(risas)", "[00:10] sin hablante"];
    const bloques = leerTranscripcion(["[00:01] Terapeuta: Hola.", ...raras].join("\n"));
    expect(bloques).toHaveLength(5);
    expect(bloques.slice(1)).toEqual(raras.map((texto) => ({ tipo: "literal", texto })));
  });

  it("no inventa bloques con las líneas en blanco, ni con un texto vacío", () => {
    expect(leerTranscripcion("\n[00:01] Paciente: Hola.\r\n\r\n   \n")).toHaveLength(1);
    expect(leerTranscripcion("")).toEqual([]);
    expect(leerTranscripcion("  \n ")).toEqual([]);
  });
});

describe("buscarEnBloques", () => {
  const bloques = leerTranscripcion(
    "[00:01] Paciente: Mi mamá me llamó. MAMÁ siempre llama.\n[00:20] Terapeuta: ¿Y tu mama qué dijo?\nlínea suelta con mamá",
  );

  it("encuentra sin distinguir mayúsculas ni tildes, en orden de lectura", () => {
    const halladas = buscarEnBloques(bloques, "mama");
    expect(halladas.map((c) => c.bloque)).toEqual([0, 0, 1, 2]);
    // Las posiciones valen sobre el texto original, que es el que se resalta.
    expect(halladas.map((c) => bloques[c.bloque].texto.slice(c.inicio, c.fin))).toEqual(["mamá", "MAMÁ", "mama", "mamá"]);
    expect(buscarEnBloques(bloques, "  MAMÁ ")).toHaveLength(4);
  });

  it("no busca en la marca de tiempo ni en el nombre del hablante", () => {
    expect(buscarEnBloques(bloques, "Terapeuta")).toEqual([]);
    expect(buscarEnBloques(bloques, "00:20")).toEqual([]);
  });

  it("búsqueda vacía, de una letra o sin resultados: ninguna coincidencia", () => {
    expect(buscarEnBloques(bloques, "")).toEqual([]);
    expect(buscarEnBloques(bloques, "   ")).toEqual([]);
    expect(buscarEnBloques(bloques, "m")).toEqual([]);
    expect(buscarEnBloques(bloques, "hermano")).toEqual([]);
  });
});
