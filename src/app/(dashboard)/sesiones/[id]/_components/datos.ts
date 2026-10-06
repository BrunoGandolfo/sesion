// Lectura de la pantalla de una sesión: lo que se le pide a la API y las
// derivaciones puras de la fila. Sin estado, sin efectos, sin React (el
// patrón de Hoy, src/app/(dashboard)/_components/datos.ts).
//
// Las reglas no viven acá: qué casillas exige aprobar es
// confirmacionesParaAprobar (lib/sesion-clinica/aprobacion.ts), la misma con
// que el servidor rechaza; acá sólo se elige el texto que explica por qué
// Aprobar todavía no se habilita.

import { apiGet } from "@/lib/api-client";
import {
  FALTA_REVISAR_AMBAS,
  FALTA_REVISAR_MENCIONES,
  FALTA_REVISAR_RIESGO,
  FALTA_REVISAR_VERSION,
} from "@/lib/glosario";
import { CLAVE_MENCIONES } from "@/lib/sesion-clinica/aprobacion";
import type { NotaSoap, SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import type { VistaSesion } from "./selector-vista";

/** La fila de la sesión: GET /api/sesion-clinica/[id]. */
export function leerSesion(id: string, signal?: AbortSignal): Promise<SesionClinicaResponse> {
  return apiGet<SesionClinicaResponse>(`/api/sesion-clinica/${id}`, { signal });
}

export type RespuestaTranscripcion = { transcripcion: string };

/** El texto de la transcripción. Cada lectura queda auditada en el servidor
 *  ("sesion.ver_transcripcion"): quien la llama la pide una vez por apertura. */
export function leerTranscripcionDeSesion(id: string): Promise<RespuestaTranscripcion> {
  return apiGet<RespuestaTranscripcion>(`/api/sesion-clinica/${id}/transcripcion`);
}

/** La nota vigente: la aprobada si existe, si no la que escribió la IA. */
export function notaDeSesion(sesion: SesionClinicaResponse): NotaSoap {
  const nota = sesion.notaFinal ?? sesion.notaIa;
  return {
    subjetivo: nota?.subjetivo ?? "",
    objetivo: nota?.objetivo ?? "",
    analisis: nota?.analisis ?? "",
    plan: nota?.plan ?? "",
  };
}

/** Dos notas con el mismo texto en las cuatro secciones. */
export function mismaNota(a: NotaSoap, b: NotaSoap): boolean {
  return (
    a.subjetivo === b.subjetivo &&
    a.objetivo === b.objetivo &&
    a.analisis === b.analisis &&
    a.plan === b.plan
  );
}

/** Edición atada a la versión de la fila que la originó: si la sesión se
 *  reescribe (descarte, reproceso), el borrador viejo deja de aplicar sin
 *  necesidad de un efecto que lo resetee. */
export type Edicion = { version: string; generacion: number; nota: NotaSoap };

export function versionDe(sesion: SesionClinicaResponse): string {
  return `${sesion.id}:${sesion.generacion}:${sesion.estado}`;
}

/** Por qué Aprobar no se habilita todavía, o null si se puede aprobar.
 *  `claves` son las casillas que exige aprobar (clavesDeConfirmacion). */
export function motivoBloqueo({
  conflicto,
  claves,
  revisadas,
}: {
  conflicto: boolean;
  claves: readonly string[];
  revisadas: ReadonlySet<string>;
}): string | null {
  if (conflicto) return FALTA_REVISAR_VERSION;
  const faltanSenales = claves.some((clave) => clave !== CLAVE_MENCIONES && !revisadas.has(clave));
  const faltanMenciones = claves.includes(CLAVE_MENCIONES) && !revisadas.has(CLAVE_MENCIONES);
  if (faltanSenales && faltanMenciones) return FALTA_REVISAR_AMBAS;
  if (faltanMenciones) return FALTA_REVISAR_MENCIONES;
  if (faltanSenales) return FALTA_REVISAR_RIESGO;
  return null;
}

/** La cara de la sesión según el segmento que eligió la URL debajo de
 *  sesiones/[id]: ninguno es la nota. */
export function vistaDeSegmento(segmento: string | null): VistaSesion {
  return segmento === "para-vos" || segmento === "transcripcion" ? segmento : "nota";
}
