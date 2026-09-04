// Fechas de la ficha: JSON → Date.
//
// La API manda fechas como string ISO y el dominio (src/types/domain) las
// tipa como Date. Esta conversión es lo único que sobrevivió de api-ficha.ts,
// que existía para envolver tres GET fuera del contrato { data }; esos GET ya
// responden ok(…) y se leen con apiGet. Acá no hay acceso a red: solo el
// parseo, en un módulo que pueden importar la ficha y la lista de turnos sin
// que se importen entre sí.

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
