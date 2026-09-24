// Lecturas que solo necesitan los tests: la app no lee la cabecera Cookie a
// mano (auth.ts usa cookies() de Next) ni pregunta con qué clave se cifró un
// blob (descifrar lo resuelve solo). Vivían exportadas en producción sin
// ningún consumidor fuera de los tests.

import { ErrorDescifrado, estaCifrado } from "@/lib/encryption";
import { nombreCookie, TOKEN_SESION } from "@/lib/sesion-cookie";

/** El token de la cabecera Cookie, o null si no viene o no tiene la forma. */
export function tokenDeCookieHeader(
  header: string | null | undefined,
  nombre: string = nombreCookie(),
): string | null {
  if (!header) return null;
  for (const par of header.split(";")) {
    const i = par.indexOf("=");
    if (i < 0) continue;
    if (par.slice(0, i).trim() !== nombre) continue;
    const valor = par.slice(i + 1).trim();
    return TOKEN_SESION.test(valor) ? valor : null;
  }
  return null;
}

/** Id de la clave con la que se cifró el blob: el byte que sigue a "ENC2". */
export function idClaveDe(blob: Buffer): number {
  if (!estaCifrado(blob)) {
    throw new ErrorDescifrado(
      "formato",
      "el blob no tiene el prefijo ENC2: dato corrupto o sin cifrar",
    );
  }
  return blob[4];
}
