// Acceso a la API para la ficha del paciente.
//
// Todo lo que sigue el contrato { data } va por @/lib/api-client. Acá viven
// solo los tres GET que responden fuera de ese contrato y por eso el cliente
// no puede desenvolverlos:
//   - GET /api/pacientes/[id]            → { data, turnos } (turnos al lado)
//   - GET /api/pacientes/[id]/consentimiento → { consentimiento }
//   - GET /api/pacientes/[id]/progreso   → el payload pelado
// Mismo manejo de error que api-client (ApiClientError con el `error` del
// body) para que los consumidores no distingan.

import { ApiClientError, type OpcionesApi } from "@/lib/api-client";
import type { PacienteConDeuda, Turno } from "@/types/domain";

export type PacienteJson = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
};

export type TurnoJson = Omit<
  Turno,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

export function parsePaciente(p: PacienteJson): PacienteConDeuda {
  return {
    ...p,
    creadoEn: new Date(p.creadoEn),
    actualizadoEn: new Date(p.actualizadoEn),
    ultimaSesion: p.ultimaSesion ? new Date(p.ultimaSesion) : null,
  };
}

export function parseTurno(t: TurnoJson): Turno {
  return {
    ...t,
    fecha: new Date(t.fecha),
    pagoFecha: t.pagoFecha ? new Date(t.pagoFecha) : null,
    creadoEn: new Date(t.creadoEn),
    actualizadoEn: new Date(t.actualizadoEn),
  };
}

const MENSAJE_GENERICO = "No pudimos completar la operación. Intentá de nuevo.";

async function leerCrudo<T>(path: string, opciones: OpcionesApi): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    cache: "no-store",
    signal: opciones.signal,
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const mensaje =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : MENSAJE_GENERICO;
    throw new ApiClientError(mensaje, res.status);
  }
  return (await res.json()) as T;
}

export interface FichaPaciente {
  paciente: PacienteConDeuda;
  turnos: Turno[];
}

export async function fetchFichaPaciente(
  id: string,
  opciones: OpcionesApi = {},
): Promise<FichaPaciente> {
  const json = await leerCrudo<{ data: PacienteJson; turnos: TurnoJson[] }>(
    `/api/pacientes/${id}`,
    opciones,
  );
  return { paciente: parsePaciente(json.data), turnos: json.turnos.map(parseTurno) };
}

export interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: string;
  textoVersion: string;
  vigente: boolean;
}

export async function fetchConsentimiento(
  pacienteId: string,
  opciones: OpcionesApi = {},
): Promise<ConsentimientoVigente | null> {
  const json = await leerCrudo<{ consentimiento: ConsentimientoVigente | null }>(
    `/api/pacientes/${pacienteId}/consentimiento`,
    opciones,
  );
  return json.consentimiento?.vigente ? json.consentimiento : null;
}

export function fetchProgreso<T>(
  pacienteId: string,
  opciones: OpcionesApi = {},
): Promise<T> {
  return leerCrudo<T>(`/api/pacientes/${pacienteId}/progreso`, opciones);
}
