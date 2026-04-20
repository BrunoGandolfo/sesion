import type {
  Configuracion as PrismaConfiguracion,
  Paciente as PrismaPaciente,
  Recordatorio as PrismaRecordatorio,
  Turno as PrismaTurno,
} from "@prisma/client";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  PacienteConDeuda,
  Recordatorio,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";

type TurnoStats = Pick<
  PrismaTurno,
  "fecha" | "estado" | "pagoEstado" | "tarifaCobrada"
>;

export type PacienteWithStats = PrismaPaciente & {
  turnos: TurnoStats[];
};

export type DashboardData = {
  kpis: KPIsDashboard;
  sesionesHoy: TurnoConPaciente[];
  deudores: DeudaPaciente[];
  proximaSesion: TurnoConPaciente | null;
  sesionesSemana: number[];
};

export function toPacienteConDeuda(
  paciente: PacienteWithStats,
): PacienteConDeuda {
  const realizadas = paciente.turnos.filter(
    (turno) => turno.estado === "realizado",
  );
  const pagadas = paciente.turnos.filter(
    (turno) => turno.pagoEstado === "pagado",
  );
  const impagas = realizadas.filter(
    (turno) => turno.pagoEstado === "pendiente",
  );

  return {
    ...paciente,
    sesionesRealizadas: realizadas.length,
    totalCobrado: sumTarifas(pagadas),
    sesionesImpagas: impagas.length,
    deudaTotal: sumTarifas(impagas),
    ultimaSesion: maxFecha(realizadas),
  };
}

export function toTurno(turno: PrismaTurno): Turno {
  return turno as unknown as Turno;
}

export function toTurnoConPaciente(
  turno: PrismaTurno & {
    paciente: Pick<PrismaPaciente, "id" | "nombre" | "apellido" | "telefono">;
  },
): TurnoConPaciente {
  return {
    ...toTurno(turno),
    paciente: turno.paciente,
  };
}

export function toRecordatorio(recordatorio: PrismaRecordatorio): Recordatorio {
  return recordatorio as Recordatorio;
}

export function toConfiguracion(
  configuracion: PrismaConfiguracion,
): Configuracion {
  return configuracion;
}

export function sumTarifas(turnos: TurnoStats[]) {
  return turnos.reduce((total, turno) => total + turno.tarifaCobrada, 0);
}

export function maxFecha(turnos: TurnoStats[]) {
  if (turnos.length === 0) return null;
  return turnos.reduce<Date | null>((latest, turno) => {
    if (!latest || turno.fecha > latest) return turno.fecha;
    return latest;
  }, null);
}

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfWeekMonday(date: Date) {
  const day = startOfDay(date);
  const mondayOffset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - mondayOffset);
  return day;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
