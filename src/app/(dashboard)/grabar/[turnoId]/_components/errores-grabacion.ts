// El catálogo de errores de la grabación: qué le decimos a ella cuando el
// micrófono no arranca o la grabación no sale (MENSAJE_ERROR_GRABADOR, con
// los textos en el glosario), y cómo se lee un error al subir: sin red, un
// rechazo del servidor que reintentar no arregla, o algo que se reintenta.
// Ningún texto del navegador (en inglés, técnico) llega a la pantalla: va a
// la consola. Lo usan flujo-grabacion.ts y el grabador (GrabadorSesion.tsx).

import { ApiClientError, esAbort, mensajeParaElla } from "@/lib/api-client";
import {
  AUDIO_NO_GUARDADO,
  AUDIO_NO_GUARDADO_SIN_COPIA,
  COPIA_NO_GUARDADA,
  GRABACION_BLOQUEADA,
  GRABACION_NO_INICIO,
  GRABACION_NO_SE_DETUVO,
  GRABACION_SIN_CONEXION,
  GRABACION_SIN_CONEXION_SIN_COPIA,
  GRABACION_VACIA,
  MIC_NO_ENCONTRADO,
  MIC_OCUPADO,
  MIC_SIN_PERMISO,
  NAVEGADOR_SIN_GRABACION,
  RECHAZADA_SIN_COPIA,
} from "@/lib/glosario";
import { admiteAudio, leerSesionDelTurno } from "@/lib/grabacion-sesion";
import { ErrorSubida } from "@/lib/subida-audio";

/** Por qué el grabador no pudo grabar o entregar. */
export type CausaErrorGrabador =
  | "sin-permiso"
  | "sin-microfono"
  | "microfono-ocupado"
  | "bloqueada"
  | "no-inicio"
  | "sin-soporte"
  | "vacia"
  | "no-se-detuvo";

export const MENSAJE_ERROR_GRABADOR: Record<CausaErrorGrabador, string> = {
  "sin-permiso": MIC_SIN_PERMISO,
  "sin-microfono": MIC_NO_ENCONTRADO,
  "microfono-ocupado": MIC_OCUPADO,
  bloqueada: GRABACION_BLOQUEADA,
  "no-inicio": GRABACION_NO_INICIO,
  "sin-soporte": NAVEGADOR_SIN_GRABACION,
  // El micrófono no entregó nada: ese audio no se recupera.
  vacia: GRABACION_VACIA,
  "no-se-detuvo": GRABACION_NO_SE_DETUVO,
};

/**
 * Lo que tira `getUserMedia` (o el MediaRecorder al crearse), como causa.
 * Los nombres duplicados (`NotAllowedError`/`PermissionDeniedError`,
 * `NotFoundError`/`DevicesNotFoundError`, `NotReadableError`/`TrackStartError`)
 * son el mismo caso con el nombre viejo y el nuevo según el navegador. Lo que
 * no se reconoce es "no-inicio": su texto original no se muestra.
 */
export function causaDelErrorDeMicrofono(error: unknown): CausaErrorGrabador {
  if (!(error instanceof DOMException)) return "no-inicio";
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "sin-permiso";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "sin-microfono";
    case "NotReadableError":
    case "TrackStartError":
      return "microfono-ocupado";
    case "SecurityError":
      return "bloqueada";
    default:
      return "no-inicio";
  }
}

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

/** Cómo termina una subida que falló: qué fase, qué se le dice y si la
 *  sesión vuelve a "grabando" para repetir desde upload-url con el mismo
 *  blob. Nada se borra: la grabación sigue en memoria y, si se pudo, en el
 *  teléfono. */
export interface DesenlaceDelFallo {
  fase: "no-guardado" | "rechazada";
  mensaje: string;
  volverAGrabando: boolean;
}

export async function desenlaceDelFallo(
  error: unknown,
  { turno, sesionId, copiaEnTelefono }: { turno: string | null; sesionId: string | null; copiaEnTelefono: boolean },
): Promise<DesenlaceDelFallo> {
  const reintentar = (): DesenlaceDelFallo => ({
    fase: "no-guardado",
    mensaje: mensajeParaReintentar(error, copiaEnTelefono),
    volverAGrabando: sesionId !== null,
  });
  // El servidor puede decir "sigue guardada en el teléfono": sin copia, no.
  const rechazada = (mensaje: string): DesenlaceDelFallo => ({
    fase: "rechazada",
    mensaje: copiaEnTelefono ? mensaje : `${mensaje} ${RECHAZADA_SIN_COPIA}`,
    volverAGrabando: false,
  });
  // Sin red no se le pregunta nada al servidor: se reintenta cuando vuelva la
  // señal. Si la sesión llegó a quedar en "subiendo", que vuelva a
  // "grabando" (sin red no va a poder; el próximo intento lo resuelve igual).
  if (esSinConexion(error)) return reintentar();
  // El servidor no aceptó el turno o la sesión (la sesión ya se cerró, el
  // turno no es de hoy, falta la autorización): reintentar fallaría igual. Se
  // dice lo que contestó, que está escrito para ella.
  if (!sesionId && esRechazoDefinitivo(error)) {
    return rechazada(error.mensaje);
  }
  // Lo que decide es el estado de la sesión, no el código: un 409 de "no
  // llegó" deja la sesión en grabando a propósito para reintentar, y uno de
  // upload-url con la sesión en subiendo se arregla volviendo a grabando.
  // Definitivo es que la sesión ya no admita audio (la cerró el
  // mantenimiento, quedó fallida por corta, ya se procesa). Si no se puede
  // leer, se reintenta como siempre.
  if (turno && esRechazoDelServidor(error)) {
    const sesion = await leerSesionDelTurno(turno).catch(() => undefined);
    if (sesion === null || (sesion !== undefined && !admiteAudio(sesion.estado))) {
      return rechazada(error.message);
    }
  }
  return reintentar();
}
