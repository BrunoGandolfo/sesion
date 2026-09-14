import { describe, expect, it } from "vitest";

import {
  ACTUALIZAR_USO_CADA_MS,
  INACTIVIDAD_MAX_MS,
  nuevoTokenSesion,
  sesionViva,
  VIGENCIA_ABSOLUTA_MS,
  whereViva,
} from "@/lib/sesion-acceso";
import { TOKEN_SESION } from "@/lib/sesion-cookie";

const AHORA = new Date("2026-09-11T12:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function fila(cambios: Partial<{ cerradaEn: Date | null; venceEn: Date; ultimoUsoEn: Date }> = {}) {
  return {
    cerradaEn: null,
    venceEn: new Date(AHORA.getTime() + 10 * DIA),
    ultimoUsoEn: new Date(AHORA.getTime() - DIA),
    ...cambios,
  };
}

describe("sesionViva", () => {
  it("viva: abierta, no vencida, con uso reciente", () => {
    expect(sesionViva(fila(), AHORA)).toBe(true);
  });

  it("cerrada no vive, aunque no haya vencido", () => {
    expect(sesionViva(fila({ cerradaEn: new Date(AHORA.getTime() - 1000) }), AHORA)).toBe(false);
  });

  it("vencida no vive: el vencimiento es absoluto a los 30 días", () => {
    expect(VIGENCIA_ABSOLUTA_MS).toBe(30 * DIA);
    expect(sesionViva(fila({ venceEn: AHORA }), AHORA)).toBe(false);
  });

  it("sin uso 14 días no vive, aunque falten días de vencimiento", () => {
    expect(INACTIVIDAD_MAX_MS).toBe(14 * DIA);
    expect(sesionViva(fila({ ultimoUsoEn: new Date(AHORA.getTime() - 14 * DIA) }), AHORA)).toBe(false);
    expect(sesionViva(fila({ ultimoUsoEn: new Date(AHORA.getTime() - 14 * DIA + 1000) }), AHORA)).toBe(true);
  });

  it("null no vive", () => {
    expect(sesionViva(null, AHORA)).toBe(false);
  });

  it("whereViva proyecta exactamente la misma regla", () => {
    expect(whereViva(AHORA)).toEqual({
      cerradaEn: null,
      venceEn: { gt: AHORA },
      ultimoUsoEn: { gt: new Date(AHORA.getTime() - INACTIVIDAD_MAX_MS) },
    });
  });

  it("el uso se anota como mucho cada 5 minutos", () => {
    expect(ACTUALIZAR_USO_CADA_MS).toBe(5 * 60 * 1000);
  });
});

describe("nuevoTokenSesion", () => {
  it("32 bytes en base64url, distinto cada vez", () => {
    const a = nuevoTokenSesion();
    const b = nuevoTokenSesion();
    expect(TOKEN_SESION.test(a)).toBe(true);
    expect(TOKEN_SESION.test(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});
