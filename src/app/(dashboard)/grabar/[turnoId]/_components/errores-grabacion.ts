// Cómo se lee un error de la grabación al subir: sin red, un rechazo del
// servidor que reintentar no arregla, o algo que se reintenta. Lo usa
// flujo-grabacion.ts; vive aparte para que el flujo se lea entero.

import { ApiClientError, esAbort, mensajeParaElla } from "@/lib/api-client";
import {
  AUDIO_NO_GUARDADO,
  AUDIO_NO_GUARDADO_SIN_COPIA,
  COPIA_NO_GUARDADA,
  GRABACION_SIN_CONEXION,
  GRABACION_SIN_CONEXION_SIN_COPIA,
} from "@/lib/glosario";
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


/** Qué se le dice cuando la subida no salió y se puede reintentar. Sin copia
 *  en el teléfono (cuota llena, modo privado) no se promete que el audio está
 *  a salvo ahí: existe sólo mientras la pantalla siga abierta. */
export function mensajeParaReintentar(error: unknown, copiaEnTelefono: boolean): string {
  if (esSinConexion(error)) return copiaEnTelefono ? GRABACION_SIN_CONEXION : GRABACION_SIN_CONEXION_SIN_COPIA;
  if (error instanceof ApiClientError) {
    return copiaEnTelefono ? mensajeParaElla(error) : `${mensajeParaElla(error)} ${COPIA_NO_GUARDADA}`;
  }
  return copiaEnTelefono ? AUDIO_NO_GUARDADO : AUDIO_NO_GUARDADO_SIN_COPIA;
}
