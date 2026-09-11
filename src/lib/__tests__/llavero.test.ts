import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  __resetLlaveroForTests,
  claveActiva,
  clavePorId,
  ErrorLlavero,
  parsearLlavero,
  validarLlavero,
} from "@/lib/llavero";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const ORIGINAL = process.env.CLAVES_CIFRADO;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  __resetLlaveroForTests();
});

describe("parsearLlavero", () => {
  it("una sola clave: es la activa", () => {
    const ll = parsearLlavero(`1=${K1}`);
    expect(ll.activa.id).toBe(1);
    expect(ll.activa.clave.toString("base64")).toBe(K1);
    expect(ll.ids).toEqual([1]);
  });

  it("varias claves: la activa es la de id más alto, sin importar el orden", () => {
    const ll = parsearLlavero(` 2=${K2} , 1=${K1} `);
    expect(ll.activa.id).toBe(2);
    expect(ll.ids).toEqual([1, 2]);
    expect(ll.porId(1)?.clave.toString("base64")).toBe(K1);
    expect(ll.porId(3)).toBeNull();
  });

  it.each([
    ["vacía", ""],
    ["undefined", undefined],
    ["sin id", `${K1}`],
    ["id no entero", `a=${K1}`],
    ["id 0", `0=${K1}`],
    ["id 256", `256=${K1}`],
    ["id repetido", `1=${K1},1=${K2}`],
    ["clave corta", `1=${randomBytes(16).toString("base64")}`],
    ["clave que no es base64", `1=esto-no-es-base64-de-32-bytes-------------`],
    ["solo comas", ",,,"],
  ])("rechaza %s", (_nombre, texto) => {
    expect(() => parsearLlavero(texto)).toThrow(ErrorLlavero);
  });

  it("el mensaje de error nunca contiene la clave", () => {
    try {
      parsearLlavero(`1=${K1},1=${K2}`);
    } catch (error) {
      expect((error as Error).message).not.toContain(K1);
      expect((error as Error).message).not.toContain(K2);
    }
  });
});

describe("llavero del proceso", () => {
  it("lee CLAVES_CIFRADO una vez y la relee tras el reset", () => {
    process.env.CLAVES_CIFRADO = `1=${K1}`;
    __resetLlaveroForTests();
    expect(claveActiva().id).toBe(1);

    process.env.CLAVES_CIFRADO = `1=${K1},2=${K2}`;
    expect(claveActiva().id).toBe(1); // cacheado
    __resetLlaveroForTests();
    expect(claveActiva().id).toBe(2);
  });

  it("clavePorId con un id ausente lanza un error explícito", () => {
    process.env.CLAVES_CIFRADO = `2=${K2}`;
    __resetLlaveroForTests();
    expect(() => clavePorId(1)).toThrow(/clave 1 ausente del llavero/);
  });

  it("validarLlavero lanza sin la variable: la app no arranca", () => {
    delete process.env.CLAVES_CIFRADO;
    __resetLlaveroForTests();
    expect(() => validarLlavero()).toThrow(ErrorLlavero);
  });
});
