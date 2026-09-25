const HEX = "0123456789abcdef";

function bytesAHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += HEX[byte >> 4] + HEX[byte & 0x0f];
  }
  return hex;
}

/**
 * sha256 de un texto, en hex minúscula. Web Crypto, no `node:crypto`: este
 * módulo lo importa código que también corre en el navegador
 * (HotWordsManager, vía hot-words.ts), donde `node:*` no existe.
 *
 * Devuelve exactamente lo mismo que
 * `createHash("sha256").update(texto, "utf8").digest("hex")` —mismo
 * algoritmo, misma entrada UTF-8, misma codificación— porque hay hashes ya
 * escritos en `eventos_auditoria` que tienen que seguir coincidiendo.
 */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return bytesAHex(new Uint8Array(bytes));
}
