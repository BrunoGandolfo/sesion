// Unitario — qué variables exige la operación y cuándo lanzar.

import { describe, expect, it } from "vitest";

import {
  validarEnvOperacion,
  VARIABLES_OPERACION,
} from "@/lib/env-operacion";

const COMPLETO: Record<string, string | undefined> = Object.fromEntries(
  VARIABLES_OPERACION.map((v) => [v, "x"]),
);

describe("validarEnvOperacion", () => {
  it("con todo cargado no falta nada", () => {
    expect(validarEnvOperacion({ ...COMPLETO, NODE_ENV: "production" })).toEqual({
      faltantes: [],
      produccion: true,
    });
  });

  it("nombra las que faltan, y una vacía cuenta como faltante", () => {
    const { faltantes } = validarEnvOperacion({
      ...COMPLETO,
      ALERTA_CORREO: "   ",
      CRON_SECRET: undefined,
    });
    expect(faltantes).toEqual(["ALERTA_CORREO", "CRON_SECRET"]);
  });

  it("la lista tiene lo que la operación necesita", () => {
    for (const v of ["ALERTA_CORREO", "RESEND_API_KEY", "CRON_SECRET", "R2_PUBLIC_HOST"]) {
      expect(VARIABLES_OPERACION).toContain(v);
    }
    // El SMS ya no existe: sus variables no son de la operación.
    expect(VARIABLES_OPERACION.some((v) => v.startsWith("TWILIO_"))).toBe(false);
  });
});
