// Fechas y rótulos de la hoja del Recorrido, compartidos por sus piezas.

import type { ExportacionRecorrido } from "@/app/api/_lib/casos-uso/hilo/exportar";
import type { ProgresoResponse } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/progreso-contrato";
import { formatearFechaCompletaMvd, formatearFechaCortaMvd, formatearHoraMvd, partesMvd } from "@/lib/fechas-montevideo";
import type { ResumenVersionHilo } from "@/lib/hilo/contenido";

export type Exportacion = Omit<ExportacionRecorrido, "progreso"> & { progreso: ProgresoResponse };

export const dia = (iso: string) => formatearFechaCompletaMvd(new Date(iso));
export const diaYHora = (iso: string) => `${dia(iso)}, ${formatearHoraMvd(new Date(iso))}`;
/** "16 sep 2026": lo que entra en una columna del historial sin partirse. */
export const diaCorto = (iso: string) => `${formatearFechaCortaMvd(new Date(iso))} ${partesMvd(new Date(iso)).anio}`;
export const diaCortoYHora = (iso: string) => `${diaCorto(iso)}, ${formatearHoraMvd(new Date(iso))}`;
export const autoria = (v: ResumenVersionHilo) => (v.actor === "ia" ? "Propuesta de la IA" : "Edición tuya");

/** El estado de una versión dicho como lo lee ella, no como lo guarda la base. */
export function estadoLegible(v: ResumenVersionHilo, datos: Exportacion): string {
  if (v.id === datos.vigente?.id) return "Vigente";
  if (v.estado === "aplicada") {
    const edicion = datos.versiones.find((otra) => otra.propuestaOrigenId === v.id);
    return edicion ? `Aceptada con tus ediciones (versión ${edicion.version})` : "Estuvo vigente";
  }
  if (v.estado === "propuesta") return "Sin revisar";
  if (v.estado === "desactualizada") return "Desactualizada";
  return "Descartada";
}
