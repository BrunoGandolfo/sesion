// Lecturas y reglas del formulario de agendar: la propuesta de día y hora
// desde el último turno, la búsqueda de pacientes y el alta rápida de "Crear
// a X". Sin estado, sin efectos, sin React.

import { apiGet, apiPost } from "@/lib/api-client";
// Los inputs se llenan con el reloj de Montevideo porque así los lee después
// instanteDesdeFechaHoraMvd al enviar. Con getFullYear/getHours el par no
// cerraba: desde Madrid, la propuesta "el mismo día y hora que la última vez"
// mostraba las 20:15 de un turno de las 15:15 y lo agendaba a las 20:15 de
// Montevideo, cinco horas tarde.
import { agregarDiasMvd } from "@/lib/fechas-montevideo";
import { ALGO_FALLO, TARIFA_SIN_CARGAR } from "@/lib/glosario";
// La regla de la tarifa es una sola y es la del servidor (entera y mayor a
// cero). Antes acá se miraba sólo si había número: con la tarifa del
// consultorio en 0 el formulario anunciaba que iba a crear con $0 y el POST
// contestaba "Datos inválidos".
import { pacienteCreateSchema } from "@/app/api/_lib/schemas";
import type { Paciente } from "@/types/domain";

export type PacienteOpcion = Pick<Paciente, "id" | "nombre" | "apellido" | "tarifa">;

export function nombreCompleto(p: Pick<Paciente, "nombre" | "apellido">) {
  return `${p.nombre} ${p.apellido}`.trim();
}

export function coincide(p: Pick<Paciente, "nombre" | "apellido">, q: string) {
  const aguja = q.trim().toLowerCase();
  if (!aguja) return true;
  return nombreCompleto(p).toLowerCase().includes(aguja);
}

/** Una semana después del último turno, avanzando de a semanas hasta que
 *  quede en el futuro. Conserva día de la semana y hora. */
export function proponerDesdeUltimoTurno(ultimo: Date, ahora: Date): Date {
  let propuesta = agregarDiasMvd(ultimo, 7);
  while (propuesta.getTime() <= ahora.getTime()) {
    propuesta = agregarDiasMvd(propuesta, 7);
  }
  return propuesta;
}

/** Día y hora propuestos desde el último turno de la paciente (seis meses
 *  para atrás y para adelante), o null si no tiene turnos. */
export async function leerPropuesta(
  pacienteId: string,
  signal: AbortSignal,
  ahora: Date = new Date(),
): Promise<Date | null> {
  const desde = agregarDiasMvd(ahora, -180).toISOString();
  const hasta = agregarDiasMvd(ahora, 180).toISOString();
  const turnos = await apiGet<{ fecha: string }[]>(
    `/api/turnos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&pacienteId=${encodeURIComponent(pacienteId)}`,
    { signal },
  );
  if (turnos.length === 0) return null;
  const ultimo = turnos
    .map((t) => new Date(t.fecha))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return proponerDesdeUltimoTurno(ultimo, ahora);
}

/** "Ana María Pérez" → { nombre: "Ana María", apellido: "Pérez" }. */
export function separarNombre(texto: string): { nombre: string; apellido: string } {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return { nombre: partes[0] ?? "", apellido: "" };
  return {
    nombre: partes.slice(0, -1).join(" "),
    apellido: partes[partes.length - 1],
  };
}

/** ¿La tarifa del consultorio sirve para crear una paciente? La decide el
 *  mismo schema que valida el POST, no una copia. */
export function tarifaUsable(tarifaDefault: number | null): boolean {
  return pacienteCreateSchema.shape.tarifa.safeParse(tarifaDefault).success;
}

/** Crea la paciente de "Crear a X" con nombre, teléfono y la tarifa de Tu
 *  consultorio. Lanza Error con el texto para ella si falta algo, o el
 *  ApiClientError de la API. */
export async function crearPacienteRapido({
  nombreYApellido,
  telefono,
  tarifaDefault,
}: {
  nombreYApellido: string;
  telefono: string;
  tarifaDefault: number | null;
}): Promise<string> {
  const { nombre, apellido } = separarNombre(nombreYApellido);
  if (!nombre || !apellido) {
    throw new Error("Ingresá nombre y apellido");
  }
  if (!telefono.trim()) {
    throw new Error("Ingresá el teléfono");
  }
  if (tarifaDefault === null || !tarifaUsable(tarifaDefault)) {
    throw new Error(TARIFA_SIN_CARGAR);
  }
  const creado = await apiPost<Paciente>("/api/pacientes", {
    nombre,
    apellido,
    telefono: telefono.trim(),
    tarifa: tarifaDefault,
    notas: null,
  });
  return creado.id;
}

/** El texto de un fallo al crear la paciente: el de la API
 *  (ApiClientError), el de la validación de arriba, o el genérico. */
export function mensajeDeCreacion(err: unknown): string {
  return err instanceof Error ? err.message : ALGO_FALLO;
}
