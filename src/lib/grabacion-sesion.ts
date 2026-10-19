// La sesión clínica del turno, vista desde la grabación: si todavía admite
// audio, y el pedido que la lee. Cada uno en un solo lugar: los usan la
// página de grabar (motivo-sin-grabar.ts, en el servidor), el flujo de la
// subida (flujo-grabacion.ts) y la ficha (useGrabacionSesion).

import { apiGet } from "@/lib/api-client";
import { ESTADOS_SIN_TERMINAR } from "@/lib/sesion-clinica/estados";

/** Lo mínimo que la grabación necesita de la sesión. */
export interface SesionDelTurno {
  id: string;
  estado: string;
}

/** ¿La sesión todavía admite audio? Sólo una grabación a medias (grabando o
 *  subiendo). Una ya subida, procesándose, aprobada o fallida, no: reintentar
 *  la subida fallaría igual cada vez. */
export function admiteAudio(estado: string): boolean {
  return (ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(estado);
}

/** La sesión del turno, o null si todavía no se creó (nace al subir). */
export function leerSesionDelTurno<T extends SesionDelTurno = SesionDelTurno>(turnoId: string): Promise<T | null> {
  return apiGet<T | null>(`/api/sesion-clinica?turnoId=${turnoId}`);
}
