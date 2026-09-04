import { describe, expect, it } from "vitest";

import { formatearEtiqueta, mapaDeEtiquetas } from "@/lib/etiquetas";

describe("formatearEtiqueta — intervenciones", () => {
  it("nombra los ocho tipos del contrato con su nombre técnico", () => {
    expect(formatearEtiqueta("reformulacion")).toBe("Reformulación");
    expect(formatearEtiqueta("senalamiento")).toBe("Señalamiento");
    expect(formatearEtiqueta("confrontacion")).toBe("Confrontación");
    expect(formatearEtiqueta("interpretacion")).toBe("Interpretación");
    expect(formatearEtiqueta("pregunta_circular")).toBe("Pregunta circular");
    expect(formatearEtiqueta("validacion")).toBe("Validación");
    expect(formatearEtiqueta("silencio_terapeutico")).toBe(
      "Silencio terapéutico",
    );
    expect(formatearEtiqueta("otra")).toBe("Otra");
  });

  it("no depende de mayúsculas ni del separador", () => {
    expect(formatearEtiqueta("PREGUNTA_CIRCULAR")).toBe("Pregunta circular");
    expect(formatearEtiqueta("Pregunta Circular")).toBe("Pregunta circular");
    expect(formatearEtiqueta("pregunta circular")).toBe("Pregunta circular");
    expect(formatearEtiqueta("  pregunta   circular  ")).toBe(
      "Pregunta circular",
    );
  });

  it("acepta la clave ya acentuada sin duplicar el acento", () => {
    expect(formatearEtiqueta("Señalamiento")).toBe("Señalamiento");
    expect(formatearEtiqueta("interpretación")).toBe("Interpretación");
  });
});

describe("formatearEtiqueta — flags de riesgo", () => {
  it("separa el camelCase del contrato de riesgo", () => {
    expect(formatearEtiqueta("ideacionSuicida")).toBe("Ideación suicida");
    expect(formatearEtiqueta("autolesion")).toBe("Autolesión");
    expect(formatearEtiqueta("violenciaTerceros")).toBe(
      "Violencia hacia terceros",
    );
    expect(formatearEtiqueta("sintomasPsicoticos")).toBe("Síntomas psicóticos");
    expect(formatearEtiqueta("crisisPanico")).toBe("Crisis de pánico");
  });

  it("nombra los niveles de la señal graduada", () => {
    expect(formatearEtiqueta("moderado")).toBe("Moderado");
    expect(formatearEtiqueta("alto")).toBe("Alto");
  });
});

describe("formatearEtiqueta — texto libre (temas)", () => {
  it("acentúa las palabras del léxico clínico", () => {
    expect(formatearEtiqueta("limites del encuadre terapeutico")).toBe(
      "Límites del encuadre terapéutico",
    );
    expect(formatearEtiqueta("crisis de panico nocturnas")).toBe(
      "Crisis de pánico nocturnas",
    );
    expect(formatearEtiqueta("relacion con la madre")).toBe(
      "Relación con la madre",
    );
  });

  it("acentúa solo la palabra del léxico y deja el resto como vino", () => {
    expect(formatearEtiqueta("vinculo con el trabajo")).toBe(
      "Vínculo con el trabajo",
    );
    expect(formatearEtiqueta("duelo por la mudanza")).toBe(
      "Duelo por la mudanza",
    );
  });

  it("no acentúa palabras ambiguas: la forma sin tilde también existe", () => {
    // "practica" (verbo) y "critica" (verbo) son palabras válidas: cambiarlas
    // por "práctica"/"crítica" inventaría sentido.
    expect(formatearEtiqueta("practica deportiva")).toBe("Practica deportiva");
    expect(formatearEtiqueta("critica al padre")).toBe("Critica al padre");
  });

  it("conserva siglas y mayúsculas internas", () => {
    expect(formatearEtiqueta("sintomas de TCA")).toBe("Síntomas de TCA");
  });

  it("respeta la mayúscula inicial de una palabra ya acentuable", () => {
    expect(formatearEtiqueta("Limites en la pareja")).toBe(
      "Límites en la pareja",
    );
  });
});

describe("formatearEtiqueta — bordes", () => {
  it("devuelve cadena vacía para vacío o espacios", () => {
    expect(formatearEtiqueta("")).toBe("");
    expect(formatearEtiqueta("   ")).toBe("");
    expect(formatearEtiqueta("___")).toBe("");
  });

  it("nunca inventa: una clave desconocida se muestra legible, no traducida", () => {
    expect(formatearEtiqueta("encuadre_del_setting")).toBe(
      "Encuadre del setting",
    );
  });
});

describe("mapaDeEtiquetas", () => {
  it("arma el mapa clave → etiqueta que consumen las leyendas", () => {
    expect(mapaDeEtiquetas(["validacion", "pregunta_circular"])).toEqual({
      validacion: "Validación",
      pregunta_circular: "Pregunta circular",
    });
  });

  it("con lista vacía devuelve un mapa vacío", () => {
    expect(mapaDeEtiquetas([])).toEqual({});
  });
});
