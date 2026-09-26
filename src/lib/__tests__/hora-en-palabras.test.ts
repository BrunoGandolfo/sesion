// La hora del turno escrita con su franja: "10:58" no alcanza para ver que
// es de noche (el PM del selector de Android se queda pegado).
import { describe, expect, it } from "vitest";

import { horaEnPalabras, horaParaRevisar } from "@/lib/format";

describe("horaEnPalabras", () => {
  it.each([
    ["00:30", "12:30 de la madrugada"],
    ["03:15", "3:15 de la madrugada"],
    ["10:58", "10:58 de la mañana"],
    ["12:00", "12:00 del mediodía"],
    ["12:30", "12:30 de la tarde"],
    ["14:00", "2:00 de la tarde"],
    ["22:58", "10:58 de la noche"],
  ])("%s → %s", (entrada, esperado) => {
    expect(horaEnPalabras(entrada)).toBe(esperado);
  });

  it.each([
    ["05:59", "5:59 de la madrugada"],
    ["06:00", "6:00 de la mañana"],
    ["11:59", "11:59 de la mañana"],
    ["12:00", "12:00 del mediodía"],
    ["19:59", "7:59 de la tarde"],
    ["20:00", "8:00 de la noche"],
    ["23:59", "11:59 de la noche"],
    ["00:00", "12:00 de la madrugada"],
  ])("borde %s → %s", (entrada, esperado) => {
    expect(horaEnPalabras(entrada)).toBe(esperado);
  });

  it("acepta los segundos que puede traer un input de hora", () => {
    expect(horaEnPalabras("22:58:00")).toBe("10:58 de la noche");
  });

  it.each(["", "abc", "24:00", "12:60", "9:30", "10:5", "10:58 ", "22h58", "-1:00"])(
    "texto inválido %j → vacío",
    (entrada) => {
      expect(horaEnPalabras(entrada)).toBe("");
    },
  );
});

describe("horaParaRevisar", () => {
  it.each([
    ["00:00", true],
    ["06:59", true],
    ["07:00", false],
    ["10:58", false],
    ["19:59", false],
    ["20:00", true],
    ["22:58", true],
    ["23:59", true],
    ["", false],
    ["nada", false],
  ])("%j → %s", (entrada, esperado) => {
    expect(horaParaRevisar(entrada)).toBe(esperado);
  });
});
