// Si un turno se puede grabar, y si no, por qué. Lo usa la página de grabar
// (en el servidor) antes de ofrecer el botón.

import { MENSAJE_GRABAR_OTRO_DIA } from "@/app/api/_lib/casos-uso/audio";
import { sePuedeGrabar } from "@/app/api/_lib/domain";
import { SESION_EN_CAMINO, TURNO_SIN_SESION_PARA_GRABAR } from "@/lib/glosario";
import { ESTADOS_SIN_TERMINAR } from "@/lib/sesion-clinica/estados";

/**
 * Por qué este turno no se puede grabar, o null si se puede. La misma regla
 * que aplica el servidor al crear la sesión (casos-uso/audio.ts,
 * prepararAudio): una grabación a medias se retoma sea el día que sea; una
 * ya cerrada no admite otro audio; una nueva, solo el día del turno y si está
 * programado o realizado (sePuedeGrabar). Sin esto la pantalla ofrecía el botón grande para un
 * turno de ayer o cancelado, y el rechazo llegaba recién al tocarlo
 * (forense 03, P3-11).
 */
export function motivoSinGrabar(
  turno: { estado: string; fecha: Date; sesionClinica: { estado: string } | null },
  ahora: Date,
): string | null {
  const sesion = turno.sesionClinica;
  if (sesion && (ESTADOS_SIN_TERMINAR as ReadonlyArray<string>).includes(sesion.estado)) return null;
  // Una sesión ya cerrada (se subió, se está escribiendo, se aprobó, falló)
  // no admite otro audio. Antes lo decía el servidor al tocar Grabar; desde
  // que grabar no espera a la red, se dice acá, antes de ofrecer el botón: si
  // no, ella grabaría una sesión entera que después no se puede subir.
  if (sesion) return SESION_EN_CAMINO;
  if (sePuedeGrabar(turno, ahora)) return null;
  return turno.estado === "programado" || turno.estado === "realizado"
    ? MENSAJE_GRABAR_OTRO_DIA
    : TURNO_SIN_SESION_PARA_GRABAR;
}
