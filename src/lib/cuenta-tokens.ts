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
export function tokenVigente(token: { expiresAt: Date; usedAt: Date | null } | null, ahora: Date): boolean {
  return token !== null && token.usedAt === null && token.expiresAt.getTime() > ahora.getTime();
}
