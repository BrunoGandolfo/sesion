import { describe, expect, it } from "vitest";

import { detalleSeguro, DETALLE_MAX_ARRAY, DETALLE_MAX_STRING, hashTexto } from "@/app/api/_lib/auditoria-pura";

describe("detalleSeguro", () => {
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

  it("hashTexto es sha256 hex", () => {
    expect(hashTexto("hola")).toBe("b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79");
  });
});
