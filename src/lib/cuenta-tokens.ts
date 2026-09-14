import { sha256Hex } from "@/lib/crypto";

export const ORIGEN_CUENTA = "https://sesionapp.app";
export const VIGENCIA_RESET_MS = 60 * 60 * 1000;
export const MAX_RECUPERACIONES_HORA = 3;
export const TOKEN_CUENTA = /^[a-f0-9]{64}$/;

/** 32 bytes de entropía; sólo este valor viaja en el enlace, nunca a la DB. */
export function nuevoTokenCuenta(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export const hashTokenCuenta = sha256Hex;

/**
 * ¿Vale este enlace? No usado y no vencido. Para los de recuperación, además
 * `enviadoEn` no null: una fila cuyo correo no salió no vale para restablecer.
 * (`enviadoEn` ausente = invitación, que no tiene correo.)
 */
export function tokenVigente(
  token: { venceEn: Date; usadoEn: Date | null; enviadoEn?: Date | null } | null,
  ahora: Date,
): boolean {
  if (token === null) return false;
  if (token.usadoEn !== null) return false;
  if ("enviadoEn" in token && token.enviadoEn === null) return false;
  return token.venceEn.getTime() > ahora.getTime();
}
