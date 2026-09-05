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
// Solo el tipo del cliente (extendido con cifrado): este módulo no toca la
// base por sí mismo, la recibe como parámetro en buscarTurnosConDeuda.
import type { db } from "@/lib/db";
import {
  agregarDiasMvd,
  diasEnterosMvd,
  finDeMesMvd,
  finDelDiaMvd,
  inicioDeMesMvd,
  inicioDelDiaMvd,
} from "@/lib/fechas-montevideo";
import { normalizarRecordatorioModo } from "@/lib/recordatorios-programacion";

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
  /**
   * Lo que espera a la terapeuta: notas sin aprobar, sesiones sin cobrar y
   * turnos de hoy sin autorización de grabación (ver
   * casos-uso/pendientes-terapeuta.ts). Obligatorio: la pantalla de Hoy lo
   * consume desde que existe el bloque PENDIENTES.
   */
  pendientes: PendientesTerapeuta;
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

/**
 * Fila de configuración → tipo del dominio. `Configuracion` ya declara
 * `recordatorioModo`, así que la API no tiene una forma propia: el alias
 * `ConfiguracionApi` que existía acá era el mismo tipo con otro nombre.
 */
export function toConfiguracion(
  configuracion: PrismaConfiguracion,
): Configuracion {
  // En DB orientacionTeorica y recordatorioModo son String (sin enum en la
  // migración); acá se narrowean a su unión, con fallback al default ante
  // valores desconocidos — misma regla que el contrato multi-orientación.
  return {
    ...configuracion,
    orientacionTeorica:
      configuracion.orientacionTeorica === "gestalt" ? "gestalt" : "cbt_mi",
    recordatorioModo: normalizarRecordatorioModo(
      configuracion.recordatorioModo,
    ),
  };
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

export function minFecha(turnos: TurnoStats[]) {
  if (turnos.length === 0) return null;
  return turnos.reduce<Date | null>((earliest, turno) => {
    if (!earliest || turno.fecha < earliest) return turno.fecha;
    return earliest;
  }, null);
}

// ────────────────────────────────────────────────────────────────────────────
// Bordes de día y de mes — hora de Montevideo, no la del proceso.
//
// Estas cinco funciones son las que contestan "hoy", "este mes" y "hace
// cuántos días" en toda la API. Usaban setHours/getFullYear, o sea la zona
// del proceso: en Vercel, que corre en UTC y no deja fijar TZ, una sesión de
// las 21:30 de Montevideo caía en el día siguiente y desaparecía de la
// agenda del día. Ahora delegan en fechas-montevideo, única fuente de
// verdad del tiempo local; se conservan acá con su nombre para no tocar los
// veinte lugares que ya las importan.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Días enteros transcurridos desde la fecha del turno hasta hoy, contados
 * por día de calendario de Montevideo (no por períodos de 24 horas).
 * Devuelve 0 si la fecha es de hoy o futura.
 */
export function diasDesde(fecha: Date | null, ahora: Date): number {
  if (!fecha) return 0;
  return Math.max(0, diasEnterosMvd(fecha, ahora));
}

export function startOfDay(date: Date) {
  return inicioDelDiaMvd(date);
}

export function endOfDay(date: Date) {
  return finDelDiaMvd(date);
}

export function startOfMonth(date: Date) {
  return inicioDeMesMvd(date);
}

export function endOfMonth(date: Date) {
  return finDeMesMvd(date);
}

export function addDays(date: Date, days: number) {
  return agregarDiasMvd(date, days);
}

// ────────────────────────────────────────────────────────────────────────────
// Deuda — única fuente de la regla "sesión impaga".
// Misma regla que hoy repiten dashboard, deudores, toPacienteConDeuda,
// resumen-tab y turnos-pagos-tab: turno realizado con pago pendiente.
// ────────────────────────────────────────────────────────────────────────────

export function esDeudaPendiente(turno: {
  estado: string;
  pagoEstado: string;
}): boolean {
  return turno.estado === "realizado" && turno.pagoEstado === "pendiente";
}

export interface TurnoParaDeuda {
  pacienteId: string;
  paciente: { nombre: string; apellido: string };
  estado: string;
  pagoEstado: string;
  tarifaCobrada: number;
  duracionMin?: number;
  /** Fecha del turno. Si al menos un turno impago la trae, el deudor sale
   *  con `diasAtraso` (días desde el impago más antiguo). */
  fecha?: Date;
}

export interface DeudorAgrupado {
  pacienteId: string;
  nombre: string;
  apellido: string;
  sesionesImpagas: number;
  montoTotal: number;
  minutosTotales: number;
  /** Solo presente cuando la entrada trae `fecha` (ver TurnoParaDeuda). */
  diasAtraso?: number;
}

/**
 * Agrupa por paciente los turnos que son deuda pendiente. Devuelve cantidad,
 * monto y minutos por paciente, ordenado por monto descendente (a igual
 * monto, orden de aparición). Sin tope: el tope lo aplica el consumidor.
 * Un paciente sin turnos impagos no aparece.
 *
 * Si los turnos traen `fecha`, cada deudor sale además con `diasAtraso`,
 * calculado con diasDesde() sobre el impago más antiguo respecto de `ahora`
 * (default: hoy). Sin `fecha` la salida es idéntica a la de antes.
 */
export function calcularDeudores(
  turnos: TurnoParaDeuda[],
  ahora: Date = new Date(),
): DeudorAgrupado[] {
  const porPaciente = new Map<string, DeudorAgrupado>();
  const impagoMasAntiguo = new Map<string, Date>();

  for (const turno of turnos) {
    if (!esDeudaPendiente(turno)) continue;
    const actual = porPaciente.get(turno.pacienteId) ?? {
      pacienteId: turno.pacienteId,
      nombre: turno.paciente.nombre,
      apellido: turno.paciente.apellido,
      sesionesImpagas: 0,
      montoTotal: 0,
      minutosTotales: 0,
    };
    actual.sesionesImpagas += 1;
    actual.montoTotal += turno.tarifaCobrada;
    actual.minutosTotales += turno.duracionMin ?? 0;
    porPaciente.set(turno.pacienteId, actual);

    if (turno.fecha) {
      const previa = impagoMasAntiguo.get(turno.pacienteId);
      if (!previa || turno.fecha < previa) {
        impagoMasAntiguo.set(turno.pacienteId, turno.fecha);
      }
    }
  }

  for (const [pacienteId, fecha] of impagoMasAntiguo) {
    const deudor = porPaciente.get(pacienteId);
    if (deudor) deudor.diasAtraso = diasDesde(fecha, ahora);
  }

  return [...porPaciente.values()].sort((a, b) => b.montoTotal - a.montoTotal);
}

// ────────────────────────────────────────────────────────────────────────────
// Pendientes de la terapeuta — forma de las tres listas que devuelve
// casos-uso/pendientes-terapeuta.ts y que viajan dentro de /api/dashboard.
//
// Las fechas van como string ISO, no como Date: son datos de sólo lectura
// que la pantalla formatea, y así el tipo dice la verdad sobre lo que
// llega por la red (Response.json ya serializa toda Date a ISO).
// ────────────────────────────────────────────────────────────────────────────

/** Nota generada por el pipeline que todavía nadie aprobó. */
export interface NotaParaRevisar {
  sesionId: string;
  turnoId: string;
  pacienteId: string;
  /** "Ana López" — nombre y apellido ya unidos. */
  pacienteNombre: string;
  /** Fecha y hora del turno, ISO. */
  fecha: string;
}

/**
 * Deuda de una paciente, no de un turno.
 *
 * Se cobra por persona, no por sesión: quien debe tres sesiones recibe un
 * mensaje, no tres. Por eso la lista llega agrupada y con el monto sumado,
 * y `masAntiguo` al lado, que es lo que dice cuán vieja es la deuda.
 */
export interface PacienteSinCobrar {
  pacienteId: string;
  pacienteNombre: string;
  /** Cuántas sesiones realizadas e impagas tiene. Siempre ≥ 1. */
  sesiones: number;
  /** Suma de las tarifas de esas sesiones. */
  monto: number;
  /** Fecha del turno impago más viejo, ISO. */
  masAntiguo: string;
}

/** El pie del bloque: cuánto es todo junto. */
export interface TotalSinCobrar {
  sesiones: number;
  monto: number;
  pacientes: number;
}

/** Turno de hoy cuya paciente no firmó la autorización de grabación. */
export interface TurnoSinAutorizacion {
  turnoId: string;
  pacienteId: string;
  pacienteNombre: string;
  fecha: string;
}

export interface PendientesTerapeuta {
  notasParaRevisar: NotaParaRevisar[];
  /** Agrupado por paciente, de la deuda más grande a la más chica. */
  sinCobrar: PacienteSinCobrar[];
  totalSinCobrar: TotalSinCobrar;
  sinAutorizacion: TurnoSinAutorizacion[];
}

// ────────────────────────────────────────────────────────────────────────────
// Deudores — query única y forma de respuesta de /api/deudores.
// ────────────────────────────────────────────────────────────────────────────

/** Item de /api/deudores: DeudaPaciente más lo que la UI de finanzas
 *  necesita para el recordatorio de cobro (teléfono para wa.me y minutos
 *  impagos para "Trabajaste X horas gratis"). */
export type DeudoresApiItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
};

/** Turno con deuda pendiente tal como lo devuelve buscarTurnosConDeuda. */
export interface TurnoConDeuda extends TurnoParaDeuda {
  fecha: Date;
  duracionMin: number;
  paciente: { nombre: string; apellido: string; telefono: string };
}

/**
 * Query única de los turnos que son deuda pendiente de una organización
 * (regla esDeudaPendiente aplicada en la propia consulta). La consumen
 * /api/dashboard y /api/deudores, que después pasan el resultado por
 * calcularDeudores y aplican cada uno su orden y su tope.
 */
export async function buscarTurnosConDeuda(
  prisma: typeof db,
  organizationId: string,
): Promise<TurnoConDeuda[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      organizationId,
      estado: "realizado",
      pagoEstado: "pendiente",
    },
    select: {
      pacienteId: true,
      fecha: true,
      estado: true,
      pagoEstado: true,
      tarifaCobrada: true,
      duracion: true,
      paciente: {
        select: { nombre: true, apellido: true, telefono: true },
      },
    },
  });

  return turnos.map((turno) => ({
    pacienteId: turno.pacienteId,
    paciente: turno.paciente,
    estado: turno.estado,
    pagoEstado: turno.pagoEstado,
    tarifaCobrada: turno.tarifaCobrada,
    duracionMin: turno.duracion,
    fecha: turno.fecha,
  }));
}
