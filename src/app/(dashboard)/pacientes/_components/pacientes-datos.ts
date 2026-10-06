// Lectura y mutaciones de la lista de pacientes. Sin estado, sin efectos,
// sin React: el borde entre /api/pacientes y la pantalla.

import { apiGet, apiPatch } from "@/lib/api-client";
import { parsePaciente, type PacienteJson } from "@/lib/json-turno";
import type { Configuracion, PacienteConDeuda } from "@/types/domain";

export type Segment = "activos" | "archivados";

export type TipoDeVacio = "search" | "noPatients" | "noArchived";

export async function leerPacientes({
  segment,
  query,
  signal,
}: {
  segment: Segment;
  query: string;
  signal?: AbortSignal;
}): Promise<PacienteConDeuda[]> {
  const params = new URLSearchParams({
    activo: segment === "activos" ? "true" : "false",
  });
  const cleanQuery = query.trim();

  if (cleanQuery) {
    params.set("q", cleanQuery);
  }

  const lista = await apiGet<PacienteJson[]>(
    `/api/pacientes?${params.toString()}`,
    { signal },
  );
  return lista.map(parsePaciente);
}

/** Tarifa por sesión de Tu consultorio, para sugerirla al paciente nuevo.
 *  Sin configuración no hay tarifa sugerida: null. */
export async function leerTarifaDefault(): Promise<number | null> {
  try {
    const config = await apiGet<Configuracion>("/api/config");
    return config.tarifaDefault;
  } catch {
    return null;
  }
}

export function reactivarPaciente(pacienteId: string): Promise<unknown> {
  return apiPatch(`/api/pacientes/${pacienteId}`, { activo: true });
}

/** Vuelve a meter a una paciente en la lista, en orden de apellido. */
export function conPaciente(
  lista: PacienteConDeuda[],
  paciente: PacienteConDeuda,
): PacienteConDeuda[] {
  return [...lista, paciente].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`),
  );
}

/** Qué estado vacío corresponde, o null si hay pacientes que mostrar. */
export function tipoDeVacio(
  cantidad: number,
  busqueda: string,
  segmento: Segment,
): TipoDeVacio | null {
  if (cantidad > 0) return null;
  if (busqueda.trim()) return "search";
  return segmento === "activos" ? "noPatients" : "noArchived";
}
