import { describe, expect, it } from "vitest";

import { detalleDeError } from "@/lib/detalle-error";

describe("detalleDeError", () => {
  it("devuelve el message de un Error", () => {
    expect(detalleDeError(new TypeError("fetch failed"))).toBe("fetch failed");
  });

  it("convierte lo que no es Error, o usa el texto dado", () => {
    expect(detalleDeError("ECONNRESET")).toBe("ECONNRESET");
    expect(detalleDeError(42)).toBe("42");
    expect(detalleDeError({ raro: true }, "desconocido")).toBe("desconocido");
  });
});
