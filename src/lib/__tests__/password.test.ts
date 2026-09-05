import { describe, expect, it } from "vitest";

import {
  BCRYPT_RONDAS,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  largoEnBytes,
  validarPasswordNueva,
} from "@/lib/password";

const VALIDA = "sesiones-2026";

describe("validarPasswordNueva — largo", () => {
  it("acepta una contraseña del largo mínimo", () => {
    expect(validarPasswordNueva("a".repeat(PASSWORD_MIN))).toEqual({ ok: true });
  });

  it("rechaza una más corta que el mínimo y dice cuánto falta", () => {
    const resultado = validarPasswordNueva("a".repeat(PASSWORD_MIN - 1));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toContain(String(PASSWORD_MIN));
    }
  });

  it("rechaza la que pasa el máximo que bcrypt sabe leer", () => {
    // bcrypt mira 72 bytes y descarta el resto en silencio: si esto se
    // aceptara, dos contraseñas distintas con los mismos primeros 72 bytes
    // abrirían la misma cuenta.
    const resultado = validarPasswordNueva("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(resultado.ok).toBe(false);
  });

  it("cuenta bytes y no caracteres: las tildes ocupan dos", () => {
    // 40 "ñ" son 80 bytes, y entran holgadas en 72 caracteres.
    const conEnies = "ñ".repeat(40);
    expect(conEnies.length).toBeLessThanOrEqual(PASSWORD_MAX_BYTES);
    expect(largoEnBytes(conEnies)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(validarPasswordNueva(conEnies).ok).toBe(false);
  });

  it("rechaza una hecha sólo de espacios aunque sea larga", () => {
    expect(validarPasswordNueva(" ".repeat(PASSWORD_MIN + 5)).ok).toBe(false);
  });
});

describe("validarPasswordNueva — tiene que ser un cambio", () => {
  it("rechaza la misma contraseña que ya tenía", () => {
    const resultado = validarPasswordNueva(VALIDA, VALIDA);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toContain("distinta");
    }
  });

  it("acepta una distinta de la actual", () => {
    expect(validarPasswordNueva(VALIDA, "otra-cosa-larga")).toEqual({
      ok: true,
    });
  });

  it("sin contraseña actual no compara nada", () => {
    expect(validarPasswordNueva(VALIDA)).toEqual({ ok: true });
  });
});

describe("costo de bcrypt", () => {
  it("es el mismo con el que se creó el usuario en el seed", () => {
    // Si esto cambia, cambia también el costo de cada login. Está acá para
    // que sea una decisión y no un descuido.
    expect(BCRYPT_RONDAS).toBe(10);
  });
});
