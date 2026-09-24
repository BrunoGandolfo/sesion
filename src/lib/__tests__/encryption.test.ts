import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  aadDe,
  cifrar,
  descifrar,
  ErrorDescifrado,
  estaCifrado,
  LARGO_MINIMO_BLOB,
  MAGIC_ENC2,
} from "@/lib/encryption";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { idClaveDe } from "./ayudantes";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const ORIGINAL = process.env.CLAVES_CIFRADO;

const AAD = aadDe("pacientes", "notas_encrypted", "fila-a");

function llavero(texto: string) {
  process.env.CLAVES_CIFRADO = texto;
  __resetLlaveroForTests();
}

beforeEach(() => llavero(`1=${K1}`));

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  __resetLlaveroForTests();
});

describe("formato ENC2", () => {
  it("cifra con el prefijo, el id de la clave activa y el largo mínimo", () => {
    const blob = cifrar("hola", AAD);
    expect(blob.subarray(0, 4).equals(MAGIC_ENC2)).toBe(true);
    expect(blob.subarray(0, 4).toString("ascii")).toBe("ENC2");
    expect(idClaveDe(blob)).toBe(1);
    expect(blob.length).toBe(LARGO_MINIMO_BLOB + Buffer.byteLength("hola"));
    expect(estaCifrado(blob)).toBe(true);
  });

  it("dos cifrados del mismo texto son distintos (IV aleatorio) y los dos descifran", () => {
    const a = cifrar("igual", AAD);
    const b = cifrar("igual", AAD);
    expect(a.equals(b)).toBe(false);
    expect(descifrar(a, AAD)).toBe("igual");
    expect(descifrar(b, AAD)).toBe("igual");
  });

  it("texto vacío y unicode sobreviven el viaje", () => {
    expect(descifrar(cifrar("", AAD), AAD)).toBe("");
    const texto = "ñandú 🦜 — “comillas” \n\t中文";
    expect(descifrar(cifrar(texto, AAD), AAD)).toBe(texto);
  });

  it("un blob ENC1 o basura se rechaza por formato", () => {
    const enc1 = Buffer.concat([Buffer.from("ENC1"), randomBytes(40)]);
    expect(estaCifrado(enc1)).toBe(false);
    expect(() => descifrar(enc1, AAD)).toThrow(ErrorDescifrado);
    try {
      descifrar(enc1, AAD);
    } catch (e) {
      expect((e as ErrorDescifrado).codigo).toBe("formato");
    }
    expect(() => idClaveDe(Buffer.from("corto"))).toThrow(ErrorDescifrado);
    expect(estaCifrado(null)).toBe(false);
  });
});

describe("AAD: el blob queda atado a su celda", () => {
  it("con el mismo AAD descifra", () => {
    expect(descifrar(cifrar("nota", AAD), AAD)).toBe("nota");
  });

  it.each([
    ["otra fila", aadDe("pacientes", "notas_encrypted", "fila-b")],
    ["otra columna", aadDe("pacientes", "otra_encrypted", "fila-a")],
    ["otra tabla", aadDe("turnos", "notas_encrypted", "fila-a")],
  ])("copiado a %s no descifra", (_caso, otroAad) => {
    const blob = cifrar("nota", AAD);
    expect(() => descifrar(blob, otroAad)).toThrow(ErrorDescifrado);
    try {
      descifrar(blob, otroAad);
    } catch (e) {
      expect((e as ErrorDescifrado).codigo).toBe("autenticacion");
    }
  });

  it("cifrar y descifrar exigen AAD no vacío", () => {
    expect(() => cifrar("x", "")).toThrow(/AAD/);
    expect(() => descifrar(cifrar("x", AAD), "")).toThrow(/AAD/);
    expect(() => aadDe("", "c", "i")).toThrow();
  });

  it("un byte alterado del ciphertext o del tag no descifra", () => {
    const blob = cifrar("nota", AAD);
    const alterado = Buffer.from(blob);
    alterado[alterado.length - 1] ^= 0x01;
    expect(() => descifrar(alterado, AAD)).toThrow(ErrorDescifrado);
    const tagRoto = Buffer.from(blob);
    tagRoto[20] ^= 0x01;
    expect(() => descifrar(tagRoto, AAD)).toThrow(ErrorDescifrado);
  });
});

describe("rotación por id de clave", () => {
  it("lo nuevo sale con la clave activa; lo viejo se sigue leyendo con la suya", () => {
    const viejo = cifrar("viejo", AAD);
    expect(idClaveDe(viejo)).toBe(1);

    llavero(`1=${K1},2=${K2}`);
    const nuevo = cifrar("nuevo", AAD);
    expect(idClaveDe(nuevo)).toBe(2);
    expect(descifrar(viejo, AAD)).toBe("viejo");
    expect(descifrar(nuevo, AAD)).toBe("nuevo");
  });

  it("sacar la clave vieja antes de re-cifrar da un error explícito, no texto vacío", () => {
    const viejo = cifrar("viejo", AAD);
    llavero(`2=${K2}`);
    try {
      descifrar(viejo, AAD);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorDescifrado);
      expect((e as ErrorDescifrado).codigo).toBe("clave_ausente");
      expect((e as Error).message).toMatch(/clave 1 ausente del llavero/);
    }
  });

  it("una clave distinta con el mismo id no descifra (autenticación)", () => {
    const blob = cifrar("x", AAD);
    llavero(`1=${K2}`);
    try {
      descifrar(blob, AAD);
      expect.unreachable();
    } catch (e) {
      expect((e as ErrorDescifrado).codigo).toBe("autenticacion");
    }
  });
});
