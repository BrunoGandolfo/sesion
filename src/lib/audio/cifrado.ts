import { aadSegmento, MAX_BYTES_SEGMENTO } from "./contrato";

export function base64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, n => String.fromCharCode(n)).join(""));
}

export async function importarClave(clave: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(clave), c => c.charCodeAt(0));
  try { return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]); }
  finally { bytes.fill(0); }
}

/** Solo retorna ciphertext||tag. IV y huella viven fuera del contenido. */
export async function cifrarSegmento(blob: Blob, clave: CryptoKey, organizationId: string, sesionId: string, indice: number, inicioMs: number) {
  if (!blob.size || blob.size + 16 > MAX_BYTES_SEGMENTO) throw new Error("El segmento excede el tamaño admitido");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claro = new Uint8Array(await blob.arrayBuffer());
  try {
    const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadSegmento(organizationId, sesionId, indice) }, clave, claro);
    const huella = new Uint8Array(await crypto.subtle.digest("SHA-256", cifrado));
    return { indice, inicioMs, iv: base64(iv), bytes: cifrado.byteLength, sha256: Array.from(huella, n => n.toString(16).padStart(2, "0")).join(""), cifrado };
  } finally { claro.fill(0); }
}
