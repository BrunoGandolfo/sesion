// JSON → Date de un turno y de una paciente, tal como los manda la API.
//
// La API serializa las fechas como string ISO y el dominio (src/types/domain)
// las tipa como Date. Había cuatro copias de parseTurno (Hoy, Agenda, Cobros
// y la ficha) y tres de parsePaciente (forense 03, P3-16); ésta es la única.
//
// Módulo puro, sin red: lo importan pantallas de cliente.

import type { PacienteConDeuda, Turno } from "@/types/domain";

type FechasDeTurno = "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn";

/** Un turno (con o sin la paciente) tal como llega en el JSON. */
export type TurnoJson<T extends Turno = Turno> = Omit<T, FechasDeTurno> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

export type PacienteJson = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
};

export function parseTurno<T extends Turno = Turno>(raw: TurnoJson<T>): T {
  return {
    ...raw,
    fecha: new Date(raw.fecha),
    pagoFecha: raw.pagoFecha ? new Date(raw.pagoFecha) : null,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
  } as T;
}

export function parsePaciente(raw: PacienteJson): PacienteConDeuda {
  return {
    ...raw,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
    ultimaSesion: raw.ultimaSesion ? new Date(raw.ultimaSesion) : null,
  };
}
