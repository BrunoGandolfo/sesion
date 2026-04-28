import { describe, it, expect } from "vitest";

import {
  CONSENTIMIENTO_VERSION,
  esConsentimientoVigente,
  generarTextoConsentimiento,
} from "@/lib/consentimiento";

const baseParams = {
  nombrePaciente: "María González",
  nombreProfesional: "Lic. Ana Pérez",
  direccionConsultorio: "Av. 18 de Julio 1234, Montevideo",
};

describe("generarTextoConsentimiento", () => {
  it("incluye el nombre del paciente", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("María González");
  });

  it("incluye el nombre del profesional", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("Lic. Ana Pérez");
  });

  it("incluye la dirección del consultorio", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("Av. 18 de Julio 1234, Montevideo");
  });

  it("incluye la versión del consentimiento", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain(CONSENTIMIENTO_VERSION);
  });

  it("menciona la Ley 18.331", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("18.331");
  });
});

describe("esConsentimientoVigente", () => {
  it("devuelve true cuando está firmado y no revocado", () => {
    expect(
      esConsentimientoVigente({
        firmadoEn: new Date("2026-01-01"),
        revocadoEn: null,
      }),
    ).toBe(true);
  });

  it("devuelve false cuando tiene fecha de revocación", () => {
    expect(
      esConsentimientoVigente({
        firmadoEn: new Date("2026-01-01"),
        revocadoEn: new Date("2026-02-01"),
      }),
    ).toBe(false);
  });

  it("devuelve false cuando el consentimiento es null", () => {
    expect(esConsentimientoVigente(null)).toBe(false);
  });
});
