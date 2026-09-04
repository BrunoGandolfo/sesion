// Lectura de la pantalla de Hoy: los tipos que viajan por la red, la vuelta
// a Date y la única función que pide los datos.
//
// Vive fuera de dashboard.tsx porque no es pantalla: es el borde entre
// /api/dashboard y el render. Sin estado, sin efectos, sin React.

import { apiGet } from "@/lib/api-client";
import type { DashboardData, PendientesTerapeuta } from "@/app/api/_lib/domain";
import type {
  Configuracion,
  PacienteConDeuda,
  TurnoConPaciente,
} from "@/types/domain";

/** Lo que se muestra cuando /api/dashboard todavía no manda `pendientes`. */
export const SIN_PENDIENTES: PendientesTerapeuta = {
  notasParaRevisar: [],
  sinCobrar: [],
  sinAutorizacion: [],
  totalSinCobrar: { sesiones: 0, monto: 0, pacientes: 0 },
};

// JSON convierte Date → string. Volvemos a Date solo donde el UI lo necesita.
export type JsonTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

export type JsonPaciente = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & { creadoEn: string; actualizadoEn: string; ultimaSesion: string | null };

export type JsonDashboard = Omit<
  DashboardData,
  "sesionesHoy" | "proximaSesion"
> & {
  sesionesHoy: JsonTurno[];
  proximaSesion: JsonTurno | null;
};

export function parseTurno(raw: JsonTurno): TurnoConPaciente {
  return {
    ...raw,
    fecha: new Date(raw.fecha),
    pagoFecha: raw.pagoFecha ? new Date(raw.pagoFecha) : null,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
  };
}

export function parsePaciente(raw: JsonPaciente): PacienteConDeuda {
  return {
    ...raw,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
    ultimaSesion: raw.ultimaSesion ? new Date(raw.ultimaSesion) : null,
  };
}

export interface EstadoHoy {
  data: DashboardData;
  nombre: string | null;
  /** `ahora` se construye recién con los datos, ya en el cliente: armarlo
   *  durante el render del servidor (UTC) daba textos distintos a los de
   *  Montevideo y disparaba el mismatch de hidratación React #418. */
  ahora: Date;
}

export interface DiaRepartido {
  pendientes: PendientesTerapeuta;
  /** Los turnos del día, en hora ascendente. */
  turnos: TurnoConPaciente[];
  /** turnoId → sesionId de la nota que espera revisión. */
  notaPorTurno: Map<string, string>;
  /** turnoIds cuya paciente no firmó la autorización de grabación. */
  sinAutorizacion: Set<string>;
  /** La sesión en curso, o la próxima del día si no hay ninguna abierta. */
  ahoraTurno: TurnoConPaciente | null;
  /** `ahoraTurno` ya empezó y todavía no terminó. */
  enCurso: boolean;
  /** `ahoraTurno` tiene algo que cobrar. */
  ahoraSinCobrar: boolean;
}

/**
 * Reparte la respuesta del día entre los bloques de la pantalla. Derivación
 * pura: no aplica ninguna regla nueva, solo indexa lo que ya vino resuelto
 * por casos-uso/pendientes-terapeuta.ts.
 *
 * `sinCobrar` viene agrupado por paciente (quien debe seis sesiones es un
 * pendiente, no seis), así que para el turno de AHORA se cruza la pertenencia
 * del paciente con el estado de pago del propio turno: eso es lo que decide
 * si hay algo que cobrar en ESTE turno.
 */
export function repartirElDia(data: DashboardData, ahora: Date): DiaRepartido {
  const pendientes = data.pendientes ?? SIN_PENDIENTES;
  const turnos = [...data.sesionesHoy].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );

  const abierto = turnos.find(
    (t) =>
      t.fecha.getTime() <= ahora.getTime() &&
      ahora.getTime() < t.fecha.getTime() + t.duracion * 60000,
  );
  const ahoraTurno =
    abierto ?? turnos.find((t) => t.fecha.getTime() >= ahora.getTime()) ?? null;

  const debenPacientes = new Set(pendientes.sinCobrar.map((d) => d.pacienteId));

  return {
    pendientes,
    turnos,
    notaPorTurno: new Map(
      pendientes.notasParaRevisar.map((n) => [n.turnoId, n.sesionId]),
    ),
    sinAutorizacion: new Set(
      pendientes.sinAutorizacion.map((t) => t.turnoId),
    ),
    ahoraTurno,
    enCurso: Boolean(abierto),
    ahoraSinCobrar:
      ahoraTurno !== null &&
      debenPacientes.has(ahoraTurno.paciente.id) &&
      ahoraTurno.estado === "realizado" &&
      ahoraTurno.pagoEstado === "pendiente",
  };
}

/** Lectura pura: sin estado ni efectos. El resultado entra por then(). */
export async function leerHoy(): Promise<EstadoHoy> {
  const [raw, config] = await Promise.all([
    apiGet<JsonDashboard>("/api/dashboard"),
    apiGet<Pick<Configuracion, "nombreProfesional">>("/api/config").catch(
      () => null,
    ),
  ]);
  return {
    data: {
      ...raw,
      sesionesHoy: raw.sesionesHoy.map(parseTurno),
      proximaSesion: raw.proximaSesion ? parseTurno(raw.proximaSesion) : null,
    },
    nombre: config?.nombreProfesional?.trim().split(/\s+/)[0] || null,
    ahora: new Date(),
  };
}
