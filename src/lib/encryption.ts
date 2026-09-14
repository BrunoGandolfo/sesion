// Cifrado en reposo, versión 2 (ENC2).
//
// FORMATO DEL BLOB
//
//   byte 0-3   "ENC2"
//   byte 4     id de la clave (1..255) con la que se cifró
//   byte 5-16  IV (12 bytes aleatorios, uno distinto por escritura)
//   byte 17-32 tag de autenticación de AES-GCM (16 bytes)
//   byte 33-   ciphertext
//
// AES-256-GCM con AAD (datos asociados autenticados). El AAD es el rótulo
// "<tabla>:<columna>:<id de la fila>" y se mezcla en el tag sin viajar en el
// blob: un blob copiado a otra fila, a otra columna o a otra tabla NO
// descifra, porque el tag no valida. Sin esto, quien tenga escritura en la
// base puede mover una nota de una paciente a otra sin que nada lo note.
//
// Qué cambia respecto de ENC1: el byte del id de clave (permite rotar sin
// ventana de mantenimiento: el llavero tiene la vieja y la nueva, y cada
// blob dice cuál le corresponde) y el AAD obligatorio. No hay lectura de
// ENC1: la base se creó desde cero con este formato.
//
// Módulo de Node (node:crypto). No alcanzable desde src/proxy.ts.

import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { claveActiva, clavePorId, ErrorLlavero } from "./llavero";

export const MAGIC_ENC2: Buffer = Buffer.from("ENC2", "ascii");

const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;
const LARGO_TAG = 16;

const POS_ID = MAGIC_ENC2.length; // 4
const POS_IV = POS_ID + 1; // 5
const POS_TAG = POS_IV + LARGO_IV; // 17
const POS_CT = POS_TAG + LARGO_TAG; // 33

/** Largo mínimo de un blob válido (sin ciphertext: un texto vacío). */
export const LARGO_MINIMO_BLOB = POS_CT;

export type CodigoErrorDescifrado = "formato" | "clave_ausente" | "autenticacion";

export class ErrorDescifrado extends Error {
  constructor(
    public readonly codigo: CodigoErrorDescifrado,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDescifrado";
  }
}

/**
 * El rótulo que ata un blob a su celda. Siempre con los nombres de la BASE
 * (snake_case), no los de Prisma: es lo que un operador puede leer en SQL.
 *   aadDe("sesiones_clinicas", "nota_ia_encrypted", "7f3a…")
 */
export function aadDe(tabla: string, columna: string, id: string): string {
  if (!tabla || !columna || !id) {
    throw new Error("aadDe: tabla, columna e id son obligatorios");
  }
  return `${tabla}:${columna}:${id}`;
}

/** ¿Tiene el prefijo ENC2 y el largo mínimo? No verifica el tag. */
export function estaCifrado(blob: Buffer | Uint8Array | null | undefined): boolean {
  if (!blob || blob.length < LARGO_MINIMO_BLOB) return false;
  return Buffer.from(blob.buffer, blob.byteOffset, MAGIC_ENC2.length).equals(
    MAGIC_ENC2,
  );
}

/** Id de la clave con la que se cifró el blob (byte 4). */
export function idClaveDe(blob: Buffer): number {
  if (!estaCifrado(blob)) {
    throw new ErrorDescifrado(
      "formato",
      "el blob no tiene el prefijo ENC2: dato corrupto o sin cifrar",
    );
  }
  return blob[POS_ID];
}

/**
 * Cifra `texto` con la clave activa del llavero, atado a `aad`.
 * `aad` es obligatorio y no vacío: cifrar sin rótulo es exactamente el
 * agujero que la versión 2 existe para cerrar.
 */
export function cifrar(texto: string, aad: string): Buffer {
  if (typeof aad !== "string" || aad.length === 0) {
    throw new Error("cifrar: el AAD es obligatorio (tabla:columna:id)");
  }
  const { id, clave } = claveActiva();
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC_ENC2, Buffer.from([id]), iv, tag, ciphertext]);
}

/**
 * Descifra un blob ENC2 atado a `aad`. Falla con ErrorDescifrado:
 *   - "formato": no es ENC2 o es demasiado corto;
 *   - "clave_ausente": el id del blob no está en el llavero (se sacó una
 *     clave antes de terminar de re-cifrar);
 *   - "autenticacion": clave equivocada, bytes alterados, o el blob es de
 *     otra fila/columna/tabla (el AAD no coincide).
 */
export function descifrar(blob: Buffer, aad: string): string {
  if (typeof aad !== "string" || aad.length === 0) {
    throw new Error("descifrar: el AAD es obligatorio (tabla:columna:id)");
  }
  if (!Buffer.isBuffer(blob) || !estaCifrado(blob)) {
    throw new ErrorDescifrado(
      "formato",
      "el blob no tiene el prefijo ENC2: dato corrupto o sin cifrar",
    );
  }

  const id = blob[POS_ID];
  let clave: Buffer;
  try {
    clave = clavePorId(id).clave;
  } catch (error) {
    if (error instanceof ErrorLlavero) {
      throw new ErrorDescifrado("clave_ausente", error.message);
    }
    throw error;
  }

  const iv = blob.subarray(POS_IV, POS_TAG);
  const tag = blob.subarray(POS_TAG, POS_CT);
  const ciphertext = blob.subarray(POS_CT);

  const decipher = createDecipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new ErrorDescifrado(
      "autenticacion",
      "el tag no valida: clave equivocada, bytes alterados o blob de otra fila",
    );
  }
}
