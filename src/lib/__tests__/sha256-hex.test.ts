// El sha256 del email pasó de `node:crypto` a Web Crypto porque el módulo que
// lo usa (src/lib/login-eventos.ts) entra en el bundle edge del middleware.
//
// Lo que este test protege NO es "que hashee": es que hashee EXACTAMENTE
// igual que antes. En `eventos_auditoria` ya hay filas escritas con
// `entidadId = "email:<sha256 hex>"`, y son el contador del rate limit del
// login. Si el hex cambiara aunque sea en un byte, esas filas dejarían de
// coincidir con la clave nueva y el bloqueo por email arrancaría de cero:
// quien está a mitad de un ataque por fuerza bruta se despertaría con el
// contador limpio.
//
// Dos capas:
//
//   1. Vectores fijos de FIPS 180-4 (los canónicos de sha256). Atan la salida
//      a un valor escrito a mano: si mañana alguien cambia el algoritmo o la
//      codificación de salida, esto rompe sin depender de ninguna otra
//      implementación.
//   2. Comparación byte a byte contra `node:crypto`, que es literalmente la
//      implementación que había antes del cambio. Cubre las entradas que
//      importan de verdad (emails con acentos, mayúsculas, largos) sin tener
//      que pegar un hex a mano por cada una.
//
// `node:crypto` acá es legal: este archivo es un test, corre en Node y no lo
// alcanza el middleware. La regla 9 de AGENTS.md es sobre la cadena del
// middleware; src/lib/__tests__/middleware-edge.test.ts la vigila.

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/crypto";

/** La implementación que había antes del cambio, tal cual. */
function sha256HexNode(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

describe("sha256Hex", () => {
  it("da los vectores canónicos de FIPS 180-4", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("da hex de 64 caracteres en minúscula", async () => {
    expect(await sha256Hex("a@b.c")).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    "a@b.c",
    "mariana@consultorio.uy",
    "MARIANA@consultorio.uy",
    "mariña@consultorio.uy",
    "",
    " ",
    "a".repeat(1000),
    "emoji🙂@consultorio.uy",
  ])("coincide byte a byte con node:crypto para %j", async (entrada) => {
    expect(await sha256Hex(entrada)).toBe(sha256HexNode(entrada));
  });

  it("distingue entradas distintas", async () => {
    const a = await sha256Hex("a@b.c");
    const b = await sha256Hex("a@b.d");
    expect(a).not.toBe(b);
  });
});
