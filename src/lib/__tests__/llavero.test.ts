import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  __resetLlaveroForTests,
  claveActiva,
  clavePorId,
  ErrorLlavero,
  fusionarLlaveros,
  llavero,
  llaveroDeVariables,
  parsearLlavero,
  validarLlavero,
} from "@/lib/llavero";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const K3 = randomBytes(32).toString("base64");
const ORIGINAL = process.env.CLAVES_CIFRADO;
const ORIGINAL_NUEVAS = process.env.CLAVES_CIFRADO_NUEVAS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  if (ORIGINAL_NUEVAS === undefined) delete process.env.CLAVES_CIFRADO_NUEVAS;
  else process.env.CLAVES_CIFRADO_NUEVAS = ORIGINAL_NUEVAS;
  __resetLlaveroForTests();
});

/** Lo observable de un llavero, sin funciones: ids, activa y cada clave. */
function foto(ll: ReturnType<typeof parsearLlavero>) {
  return {
    ids: ll.ids,
    activa: { id: ll.activa.id, clave: ll.activa.clave.toString("base64") },
    claves: ll.ids.map((id) => ll.porId(id)?.clave.toString("base64")),
  };
}

function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorLlavero);
    return (error as Error).message;
  }
  throw new Error("no lanzó");
}

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

describe("fusionarLlaveros y llaveroDeVariables", () => {
  it("fusiona las dos variables: ids de ambas, cada una con su clave", () => {
    const ll = fusionarLlaveros(parsearLlavero(`1=${K1}`), parsearLlavero(`2=${K2}`));
    expect(ll.ids).toEqual([1, 2]);
    expect(ll.porId(1)?.clave.toString("base64")).toBe(K1);
    expect(ll.porId(2)?.clave.toString("base64")).toBe(K2);
    expect(ll.porId(3)).toBeNull();
  });

  it("la activa es el id más alto del conjunto, esté en la variable que esté", () => {
    expect(llaveroDeVariables(`1=${K1}`, `2=${K2}`).activa).toMatchObject({ id: 2 });
    expect(llaveroDeVariables(`1=${K1}`, `2=${K2}`).activa.clave.toString("base64")).toBe(K2);
    // La nueva no manda por ser nueva: manda el id.
    const alReves = llaveroDeVariables(`1=${K1},3=${K3}`, `2=${K2}`);
    expect(alReves.ids).toEqual([1, 2, 3]);
    expect(alReves.activa.id).toBe(3);
    expect(alReves.activa.clave.toString("base64")).toBe(K3);
  });

  it("un id repetido entre las dos variables es ErrorLlavero, también con la misma clave", () => {
    for (const [base, nuevas] of [
      [`1=${K1}`, `1=${K2}`],
      [`1=${K1}`, `1=${K1}`],
      [`1=${K1},2=${K2}`, `3=${K3},2=${K3}`],
    ]) {
      const mensaje = mensajeDe(() => llaveroDeVariables(base, nuevas));
      expect(mensaje).toMatch(/repetido en CLAVES_CIFRADO y CLAVES_CIFRADO_NUEVAS/);
      for (const k of [K1, K2, K3]) expect(mensaje).not.toContain(k);
    }
  });

  it("una CLAVES_CIFRADO_NUEVAS mal formada falla nombrando esa variable", () => {
    expect(mensajeDe(() => llaveroDeVariables(`1=${K1}`, `2=${randomBytes(16).toString("base64")}`)))
      .toMatch(/^CLAVES_CIFRADO_NUEVAS: la clave 2 no decodifica/);
    expect(mensajeDe(() => llaveroDeVariables(`1=${K1}`, ",,,"))).toMatch(/^CLAVES_CIFRADO_NUEVAS: no tiene ninguna clave/);
  });

  it("sin CLAVES_CIFRADO la nueva sola no alcanza: la app no arranca", () => {
    expect(mensajeDe(() => llaveroDeVariables(undefined, `2=${K2}`))).toMatch(/^CLAVES_CIFRADO: falta o está vacía/);
  });

  it.each([
    ["ausente", undefined],
    ["vacía", ""],
    ["solo espacios", "  "],
  ])("con CLAVES_CIFRADO_NUEVAS %s es exactamente parsearLlavero", (_nombre, nuevas) => {
    for (const base of [`1=${K1}`, ` 2=${K2} , 1=${K1} `]) {
      expect(foto(llaveroDeVariables(base, nuevas))).toEqual(foto(parsearLlavero(base)));
    }
    for (const mala of [undefined, "", `1=${K1},1=${K2}`, `0=${K1}`]) {
      expect(mensajeDe(() => llaveroDeVariables(mala, nuevas))).toBe(mensajeDe(() => parsearLlavero(mala)));
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

  it("lee también CLAVES_CIFRADO_NUEVAS: la activa pasa a ser la nueva", () => {
    process.env.CLAVES_CIFRADO = `1=${K1}`;
    process.env.CLAVES_CIFRADO_NUEVAS = `2=${K2}`;
    __resetLlaveroForTests();
    expect(llavero().ids).toEqual([1, 2]);
    expect(claveActiva().id).toBe(2);
    expect(clavePorId(1).clave.toString("base64")).toBe(K1);
  });

  it("un id repetido entre las dos variables no arranca", () => {
    process.env.CLAVES_CIFRADO = `1=${K1}`;
    process.env.CLAVES_CIFRADO_NUEVAS = `1=${K2}`;
    __resetLlaveroForTests();
    expect(() => validarLlavero()).toThrow(ErrorLlavero);
  });

  it("CLAVES_CIFRADO_NUEVAS vacía se ignora", () => {
    process.env.CLAVES_CIFRADO = `1=${K1}`;
    process.env.CLAVES_CIFRADO_NUEVAS = "";
    __resetLlaveroForTests();
    expect(llavero().ids).toEqual([1]);
    expect(claveActiva().id).toBe(1);
  });

  it("validarLlavero lanza sin la variable: la app no arranca", () => {
    delete process.env.CLAVES_CIFRADO;
    __resetLlaveroForTests();
    expect(() => validarLlavero()).toThrow(ErrorLlavero);
  });
});
