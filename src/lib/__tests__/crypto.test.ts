import { describe, it, expect } from "vitest";

import { generarClave, cifrar, descifrar } from "@/lib/crypto";

function textoABytes(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

function bytesATexto(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

function base64ALongitud(b64: string): number {
  return Buffer.from(b64, "base64").byteLength;
}

describe("generarClave", () => {
  it("devuelve una clave AES-256 (32 bytes) en base64", async () => {
    const clave = await generarClave();
    expect(typeof clave).toBe("string");
    expect(base64ALongitud(clave)).toBe(32);
  });

  it("genera claves distintas en llamadas sucesivas", async () => {
    const a = await generarClave();
    const b = await generarClave();
    expect(a).not.toBe(b);
  });
});

describe("cifrar + descifrar", () => {
  it("roundtrip: los datos descifrados son iguales a los originales", async () => {
    const clave = await generarClave();
    const original = textoABytes("hola, sesión secreta");
    const { iv, datosCifrados } = await cifrar(original, clave);
    const descifrado = await descifrar(datosCifrados, clave, iv);
    expect(bytesATexto(descifrado)).toBe("hola, sesión secreta");
  });

  it("acepta ArrayBuffer como entrada", async () => {
    const clave = await generarClave();
    const bytes = textoABytes("payload");
    const original = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(original).set(bytes);
    const { iv, datosCifrados } = await cifrar(original, clave);
    const descifrado = await descifrar(datosCifrados, clave, iv);
    expect(bytesATexto(descifrado)).toBe("payload");
  });

  it("genera un IV distinto en cada cifrado con la misma clave", async () => {
    const clave = await generarClave();
    const datos = textoABytes("mismo input");
    const a = await cifrar(datos, clave);
    const b = await cifrar(datos, clave);
    expect(a.iv).not.toBe(b.iv);
    expect(a.datosCifrados).not.toBe(b.datosCifrados);
  });

  it("el IV cifrado mide 12 bytes (96 bits)", async () => {
    const clave = await generarClave();
    const { iv } = await cifrar(textoABytes("x"), clave);
    expect(base64ALongitud(iv)).toBe(12);
  });
});

describe("descifrar — fallos esperados", () => {
  it("falla con clave incorrecta", async () => {
    const claveBuena = await generarClave();
    const claveMala = await generarClave();
    const { iv, datosCifrados } = await cifrar(
      textoABytes("contenido"),
      claveBuena,
    );
    await expect(
      descifrar(datosCifrados, claveMala, iv),
    ).rejects.toBeDefined();
  });

  it("falla con IV incorrecto", async () => {
    const clave = await generarClave();
    const { datosCifrados } = await cifrar(textoABytes("contenido"), clave);
    const ivIncorrecto = await generarIvFalso();
    await expect(
      descifrar(datosCifrados, clave, ivIncorrecto),
    ).rejects.toBeDefined();
  });
});

describe("edge cases", () => {
  it("cifra y descifra datos vacíos", async () => {
    const clave = await generarClave();
    const vacio = new Uint8Array(0);
    const { iv, datosCifrados } = await cifrar(vacio, clave);
    const descifrado = await descifrar(datosCifrados, clave, iv);
    expect(descifrado.byteLength).toBe(0);
  });

  it("cifra y descifra 1 MB de datos", async () => {
    const clave = await generarClave();
    const tamano = 1024 * 1024;
    const original = new Uint8Array(tamano);
    for (let i = 0; i < tamano; i++) {
      original[i] = i & 0xff;
    }

    const { iv, datosCifrados } = await cifrar(original, clave);
    const descifrado = new Uint8Array(
      await descifrar(datosCifrados, clave, iv),
    );

    expect(descifrado.byteLength).toBe(tamano);
    expect(descifrado[0]).toBe(original[0]);
    expect(descifrado[tamano - 1]).toBe(original[tamano - 1]);
    expect(descifrado[tamano / 2]).toBe(original[tamano / 2]);
  });
});

async function generarIvFalso(): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.from(iv).toString("base64");
}
