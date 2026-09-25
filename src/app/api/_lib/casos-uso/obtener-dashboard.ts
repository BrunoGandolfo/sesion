// Caso de uso: la pantalla Hoy. Compone lo que ya existe (la deuda de
// domain.ts, pendientes-terapeuta) con las lecturas sueltas que vivían en
// GET /api/dashboard. La ruta ahora solo llama.
//
// La señal de riesgo del día sale del campo lógico `datos` de la sesión
// clínica (anexo de docs/esquema.md: `sesiones_clinicas.datos_encrypted` →
// `datos`, descifrado por la extensión del área 3). Acá solo se leen dos
// claves, sin texto libre.

import type { db } from "@/lib/db";
import {
  finDeMesMvd,
  finDelDiaMvd,
  inicioDeMesMvd,
  inicioDelDiaMvd,
} from "@/lib/fechas-montevideo";
import type {
  DashboardData,
  FlagsRiesgo,
  KPIsDashboard,
  SenalRiesgoDelDia,
} from "@/types/domain";

import { buscarTurnosConDeuda, toTurnoConPaciente } from "../domain";
import { deudoresDeHoy, pendientesTerapeuta } from "./pendientes-terapeuta";

type ClientePrisma = typeof db;

/** Cuántos deudores muestra Hoy; la lista completa vive en Cobros. */
export const TOPE_DEUDORES = 10;

/** Los dos campos que mira `clavesDeRiesgo`, sin el texto libre. La forma
 *  y el porqué están en `SenalRiesgoDelDia` (src/types/domain.ts). */
export function aSenalDeRiesgo(datos: unknown): SenalRiesgoDelDia {
  const objeto = (datos ?? {}) as {
    riesgoDetectado?: { nivel?: unknown } | null;
    flagsRiesgo?: FlagsRiesgo | null;
  };
  const flags = objeto.flagsRiesgo ?? null;
  return {
    riesgoDetectado: objeto.riesgoDetectado
      ? {
          nivel: objeto.riesgoDetectado.nivel,
          indicadores: [],
          evidencia: [],
          notaParaTerapeuta: null,
        }
      : null,
    flagsRiesgo: flags ? { ...flags, detalle: "" } : null,
  };
}

export interface ObtenerDashboardInput {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
}

export async function obtenerDashboard({
  prisma,
  organizationId,
  ahora,
}: ObtenerDashboardInput): Promise<DashboardData> {
  const todayStart = inicioDelDiaMvd(ahora);
  const todayEnd = finDelDiaMvd(ahora);
  const monthStart = inicioDeMesMvd(ahora);
  const monthEnd = finDeMesMvd(ahora);

  // La deuda se lee UNA vez y la comparten el KPI, la lista de "Te deben" y
  // el bloque de pendientes (ver casos-uso/pendientes-terapeuta.ts).
  const deuda = buscarTurnosConDeuda(prisma, organizationId);

  const [
    sesionesHoyCount,
    turnosConDeuda,
    ingresosMes,
    sesionesHoyRows,
    pendientes,
    sesionesDelDia,
    config,
    pacientesActivos,
    totalTurnos,
  ] = await Promise.all([
    prisma.turno.count({
      where: {
        organizationId,
        fecha: { gte: todayStart, lte: todayEnd },
        estado: { not: "cancelado" },
      },
    }),
    deuda,
    prisma.turno.aggregate({
      where: {
        organizationId,
        pagoEstado: "pagado",
        pagoFecha: { gte: monthStart, lte: monthEnd },
      },
      _sum: { tarifaCobrada: true },
    }),
    prisma.turno.findMany({
      where: {
        organizationId,
        fecha: { gte: todayStart, lte: todayEnd },
        estado: { not: "cancelado" },
      },
      include: {
        sesionClinica: { select: { id: true, estado: true, actualizadaEn: true } },
        paciente: {
          select: { id: true, nombre: true, apellido: true, telefono: true },
        },
      },
      orderBy: { fecha: "asc" },
    }),
    // Notas sin aprobar, sesiones sin cobrar y turnos de hoy sin
    // autorización: lo único de esta respuesta que pide una acción. La deuda
    // le entra ya leída para no consultarla dos veces.
    deuda.then((turnos) =>
      pendientesTerapeuta({
        prisma,
        organizationId,
        ahora,
        turnosConDeuda: turnos,
      }),
    ),
    // Las sesiones del día, sólo para saber si alguna tuvo señal de riesgo.
    prisma.sesionClinica.findMany({
      where: {
        organizationId,
        turno: { fecha: { gte: todayStart, lte: todayEnd } },
      },
      select: { datos: true },
    }),
    prisma.configuracion.findUnique({
      where: { organizationId },
      select: { tarifaDefault: true },
    }),
    prisma.paciente.count({ where: { organizationId, activo: true } }),
    prisma.turno.count({ where: { organizationId } }),
  ]);

  const sesionesHoy = sesionesHoyRows.map(toTurnoConPaciente);

  // La misma función y el mismo orden que consume el bloque de pendientes:
  // monto descendente, como la lista de Cobros.
  const deudores = deudoresDeHoy(turnosConDeuda, ahora).slice(0, TOPE_DEUDORES);

  const kpis: KPIsDashboard = {
    sesionesHoy: sesionesHoyCount,
    // El mismo total que dice el bloque de pendientes, no una suma aparte.
    deudaAcumulada: pendientes.totalSinCobrar.monto,
    ingresosMes: ingresosMes._sum.tarifaCobrada ?? 0,
  };

  return {
    inicio: {
      tarifaCargada: (config?.tarifaDefault ?? 0) > 0,
      tienePacientes: pacientesActivos > 0,
      tieneTurnos: totalTurnos > 0,
    },
    kpis,
    sesionesHoy,
    deudores,
    proximaSesion:
      sesionesHoy.find((turno) => turno.fecha.getTime() >= ahora.getTime()) ??
      null,
    pendientes,
    riesgoDelDia: sesionesDelDia.map((sesion) => aSenalDeRiesgo(sesion.datos)),
  };
}
