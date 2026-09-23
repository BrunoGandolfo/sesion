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
