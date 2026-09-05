const tieneBuffer = typeof Buffer !== "undefined";

function bytesABase64(bytes: Uint8Array): string {
  if (tieneBuffer) {
    return Buffer.from(bytes).toString("base64");
  }
  let binario = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binario += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binario);
}

function base64ABytes(b64: string): Uint8Array<ArrayBuffer> {
  if (tieneBuffer) {
    const buf = Buffer.from(b64, "base64");
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

function aBytes(datos: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (datos instanceof Uint8Array) {
    const out = new Uint8Array(datos.byteLength);
    out.set(datos);
    return out;
  }
  return new Uint8Array(datos);
}

async function importarClave(claveBase64: string): Promise<CryptoKey> {
  const raw = base64ABytes(claveBase64);
  return globalThis.crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generarClave(): Promise<string> {
  const clave = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await globalThis.crypto.subtle.exportKey("raw", clave);
  return bytesABase64(new Uint8Array(raw));
}

export async function cifrar(
  datos: ArrayBuffer | Uint8Array,
  claveBase64: string,
): Promise<{ iv: string; datosCifrados: string }> {
  const clave = await importarClave(claveBase64);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const entrada = aBytes(datos);
  const cifrado = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    entrada,
  );
  return {
    iv: bytesABase64(iv),
    datosCifrados: bytesABase64(new Uint8Array(cifrado)),
  };
}

export async function descifrar(
  datosCifrados: string,
  claveBase64: string,
  ivBase64: string,
): Promise<ArrayBuffer> {
  const clave = await importarClave(claveBase64);
  const iv = base64ABytes(ivBase64);
  const cifrado = base64ABytes(datosCifrados);
  return globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    clave,
    cifrado,
  );
}

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
 * módulo lo importa código que el middleware arrastra al bundle edge, donde
 * `node:*` no existe (ver regla 9 de AGENTS.md).
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
