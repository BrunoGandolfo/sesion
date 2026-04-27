import { describe, it, expect } from "vitest";

import { normalizePhone, formatPhoneDisplay } from "@/lib/phone";

describe("normalizePhone", () => {
  it("limpia espacios y mantiene el prefijo +598", () => {
    expect(normalizePhone("+598 99 123 456")).toBe("+59899123456");
  });

  it("limpia guiones", () => {
    expect(normalizePhone("+598-99-123-456")).toBe("+59899123456");
  });

  it("limpia paréntesis y agrega +598 cuando arranca con 0", () => {
    expect(normalizePhone("(099) 123 456")).toBe("+59899123456");
  });

  it("convierte un número uruguayo con 0 al inicio a formato E.164", () => {
    expect(normalizePhone("099123456")).toBe("+59899123456");
  });

  it("es idempotente: un número ya normalizado se mantiene igual", () => {
    expect(normalizePhone("+59899123456")).toBe("+59899123456");
  });

  it("limpia puntos también", () => {
    expect(normalizePhone("+598.99.123.456")).toBe("+59899123456");
  });

  it("tira error si el string está vacío", () => {
    expect(() => normalizePhone("")).toThrow();
  });

  it("tira error si no empieza con + ni con 0", () => {
    expect(() => normalizePhone("99123456")).toThrow();
  });

  it("tira error si el resultado no cumple E.164 (muy corto)", () => {
    expect(() => normalizePhone("+12345")).toThrow();
  });

  it("tira error si el resultado tiene caracteres no numéricos tras limpiar", () => {
    expect(() => normalizePhone("+598abc123")).toThrow();
  });
});

describe("formatPhoneDisplay", () => {
  it("formatea un celular uruguayo en grupos legibles", () => {
    expect(formatPhoneDisplay("+59899123456")).toBe("+598 99 123 456");
  });

  it("devuelve el número tal cual si no matchea el patrón uruguayo", () => {
    expect(formatPhoneDisplay("+5491123456789")).toBe("+5491123456789");
  });

  it("es estable al pasar por normalizePhone primero", () => {
    const e164 = normalizePhone("099 123 456");
    expect(formatPhoneDisplay(e164)).toBe("+598 99 123 456");
  });
});
