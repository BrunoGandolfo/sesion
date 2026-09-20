import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detalleSeguro, DETALLE_MAX_ARRAY, DETALLE_MAX_STRING, hashTexto } from "@/app/api/_lib/auditoria-pura";

describe("detalleSeguro", () => {
  // Los avisos del filtro se silencian salvo donde se los mira.
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("elimina IP y user-agent en todas sus grafías: el rastro clínico no los lleva", () => {
    const d = detalleSeguro({ ip: "1.2.3.4", ipOrigen: "1.2.3.4", userAgent: "Safari", user_agent: "Safari", sesionId: "s1" });
    expect(d).toEqual({ sesionId: "s1" });
  });

  it("elimina texto clínico, datos personales y material criptográfico", () => {
    const d = detalleSeguro({ nota: "x", transcripcion: "x", nombre: "x", email: "x", telefono: "x", claveCifrado: "x", iv: "x", accion: "ok" });
    expect(d).toEqual({ accion: "ok" });
  });

  it("conserva solo primitivos y arrays cortos de primitivos, acotados", () => {
    const d = detalleSeguro({
      texto: "prohibido",
      largo: "x".repeat(DETALLE_MAX_STRING + 10),
      lista: Array.from({ length: DETALLE_MAX_ARRAY + 5 }, (_, i) => i),
      anidado: { a: 1 },
      fn: () => 1,
      nan: Number.NaN,
      ok: true,
      nulo: null,
    });
    expect(d).toEqual({
      largo: "x".repeat(DETALLE_MAX_STRING),
      lista: Array.from({ length: DETALLE_MAX_ARRAY }, (_, i) => i),
      ok: true,
      nulo: null,
    });
  });

  it("undefined → undefined; objeto que queda vacío → {}", () => {
    expect(detalleSeguro(undefined)).toBeUndefined();
    expect(detalleSeguro({ ip: "1.2.3.4" })).toEqual({});
  });

  // ── El filtro avisa lo que descarta ────────────────────────────────────
  // El 18 de septiembre el diagnóstico del grabador viajaba anidado y se
  // perdió sin que nadie se enterara. El aviso lleva el NOMBRE de la clave y
  // NUNCA el valor: es un filtro de privacidad y sigue igual de estricto.

  it("avisa, con el nombre de la clave, lo que descarta por forma", () => {
    detalleSeguro({ diagnostico: { cortes: 3 }, fn: () => 1, ok: true });
    expect(console.warn).toHaveBeenCalledTimes(1);
    const linea = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(linea).toContain("descartado por forma");
    expect(linea).toContain("diagnostico");
    expect(linea).toContain("fn");
  });

  it("avisa aparte lo que descarta por clave prohibida, y no dice el valor", () => {
    detalleSeguro({ nombre: "Ana Pérez", transcripcion: "hoy hablamos de…", ok: true });
    const lineas = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain("clave prohibida");
    expect(lineas[0]).toContain("nombre");
    expect(lineas[0]).toContain("transcripcion");
    expect(lineas.join(" ")).not.toContain("Ana Pérez");
    expect(lineas.join(" ")).not.toContain("hoy hablamos");
  });

  it("avisa los elementos descartados de un array, marcando la clave con []", () => {
    detalleSeguro({ trabajos: ["borrar_audio_r2", { tipo: "x" }] });
    const linea = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(linea).toContain("trabajos[]");
  });

  it("no avisa cuando no descarta nada", () => {
    detalleSeguro({ ok: true, n: 1, lista: ["a", "b"] });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("el aviso no cambia lo que se persiste", () => {
    expect(detalleSeguro({ diagnostico: { cortes: 3 }, ok: true })).toEqual({ ok: true });
  });

  it("hashTexto es sha256 hex", () => {
    expect(hashTexto("hola")).toBe("b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79");
  });
});
