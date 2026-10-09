// Cómo se lee un error de la grabación al subir: sin red, un rechazo del
// servidor que reintentar no arregla, o algo que se reintenta. Lo usa
// flujo-grabacion.ts; vive aparte para que el flujo se lea entero.

import { ApiClientError, esAbort } from "@/lib/api-client";
import { ErrorSubida } from "@/lib/subida-audio";

/** Un rechazo del servidor a la subida (409 o 422 al pedir la URL o al
 *  confirmar) PUEDE ser definitivo. El PUT a R2 no entra: un 4xx de R2 (una
 *  URL vencida) se arregla pidiendo otra. */
export function esRechazoDelServidor(error: unknown): error is ErrorSubida {
  return (
    error instanceof ErrorSubida &&
    error.paso !== "put" &&
    (error.status === 409 || error.status === 422)
  );
}

/** ¿Falló porque no hay red? fetch sin red tira un TypeError que no es de
 *  la API; el PUT a R2 sin red llega como ErrorSubida sin status. */
export function esSinConexion(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof ApiClientError || esAbort(error)) return false;
  if (error instanceof ErrorSubida) return error.paso === "put" && error.status === null;
  return error instanceof TypeError;
}

/** Lo que el servidor contestó a crear el turno o la sesión y que reintentar
 *  no arregla: otro estado, otro día, sin autorización, el tope de prueba. */
export function esRechazoDefinitivo(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && [400, 403, 404, 409, 422].includes(error.status);
}

