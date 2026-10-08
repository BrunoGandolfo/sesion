// Textos propios de la pantalla de Hoy. Los que se comparten con otras
// pantallas viven en src/lib/glosario.ts; estos no salen de acá.

import { pluralizar } from "@/lib/glosario";

/** Título de la fila de Pendientes con las notas que fallaron. */
export function notasQueFallaron(cantidad: number): string {
  return pluralizar(
    cantidad,
    "nota que no se pudo escribir",
    "notas que no se pudieron escribir",
  );
}

/** Al lado de una nota fallida que ya no tiene audio ni transcripción: el
 *  reproceso la rechazaría, así que no se promete un reintento. */
export const NO_SE_PUEDE_REINTENTAR =
  "No se puede reintentar; se puede eliminar";

// ─── Recordatorios por WhatsApp ─────────────────────────────────────────────

export const RECORDATORIOS_PARA_HOY = "Recordatorios para hoy";
export const SIN_TURNOS_PARA_AVISAR = "No hay turnos para avisar hoy";
export const ABRIR_WHATSAPP = "Abrir WhatsApp";
export const SIN_AVISAR = "Sin avisar";
export const SIN_TELEFONO = "Sin teléfono";
export const SIN_ENLACE = "No se pudo preparar el mensaje";
export const VER_FICHA = "Ver ficha";
export const NO_SE_LEYERON_RECORDATORIOS =
  "No se pudieron leer los recordatorios de hoy.";
/** El WhatsApp se abrió igual; lo que falló es anotarlo. */
export const NO_SE_ANOTO_AVISO = "Se abrió WhatsApp, pero no quedó anotado.";

export function avisadoA(hora: string): string {
  return `Avisado ${hora}`;
}
