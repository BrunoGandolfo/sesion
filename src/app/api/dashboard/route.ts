import { db } from "@/lib/db";
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

import { getOrganizationId } from "../_lib/auth";
import {
  deudoresDeHoy,
  pendientesTerapeuta,
} from "../_lib/casos-uso/pendientes-terapeuta";
import { buscarTurnosConDeuda, toTurnoConPaciente } from "../_lib/domain";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPE_DEUDORES = 10;

/** Los dos campos que mira `clavesDeRiesgo`, sin el texto libre. La forma
 *  y el porqué están en `SenalRiesgoDelDia` (src/types/domain.ts). */
function aSenalDeRiesgo(datos: unknown): SenalRiesgoDelDia {
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

export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const now = new Date();
    const todayStart = inicioDelDiaMvd(now);
    const todayEnd = finDelDiaMvd(now);
    const monthStart = inicioDeMesMvd(now);
    const monthEnd = finDeMesMvd(now);

    // La deuda se lee UNA vez y la comparten el KPI, la lista de "Te deben" y
    // el bloque de pendientes (ver casos-uso/pendientes-terapeuta.ts).
    const deuda = buscarTurnosConDeuda(db, organizationId);

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
      db.turno.count({
        where: {
          organizationId,
          fecha: { gte: todayStart, lte: todayEnd },
          estado: { not: "cancelado" },
        },
      }),
      deuda,
      db.turno.aggregate({
        where: {
          organizationId,
          pagoEstado: "pagado",
          pagoFecha: { gte: monthStart, lte: monthEnd },
        },
        _sum: { tarifaCobrada: true },
      }),
      db.turno.findMany({
        where: {
          organizationId,
          fecha: { gte: todayStart, lte: todayEnd },
          estado: { not: "cancelado" },
        },
        include: {
          sesionClinica: { select: { id: true, estado: true } },
          paciente: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              telefono: true,
            },
          },
        },
        orderBy: { fecha: "asc" },
      }),
      // Notas sin aprobar, sesiones sin cobrar y turnos de hoy sin
      // autorización: lo único de esta respuesta que pide una acción. La
      // deuda le entra ya leída para no consultarla dos veces.
      deuda.then((turnos) =>
        pendientesTerapeuta({
          prisma: db,
          organizationId,
          ahora: now,
          turnosConDeuda: turnos,
        }),
      ),
      // Las sesiones del día, sólo para saber si alguna tuvo señal de riesgo.
      db.sesionClinica.findMany({
        where: {
          organizationId,
          turno: { fecha: { gte: todayStart, lte: todayEnd } },
        },
        select: { datosEstructurados: true },
      }),
      db.configuracion.findUnique({ where: { organizationId }, select: { tarifaDefault: true } }),
      db.paciente.count({ where: { organizationId, activo: true } }),
      db.turno.count({ where: { organizationId } }),
    ]);

    const sesionesHoy = sesionesHoyRows.map(toTurnoConPaciente);

    // La misma función y el mismo orden que consume el bloque de pendientes:
    // monto descendente, como la lista de Cobros. El orden por antigüedad que
    // había acá era un tercer criterio para el mismo dato y hacía que los
    // tres nombres de arriba de la pantalla no fueran los tres de abajo.
    const deudores = deudoresDeHoy(turnosConDeuda, now).slice(0, TOPE_DEUDORES);

    const kpis: KPIsDashboard = {
      sesionesHoy: sesionesHoyCount,
      // El mismo total que dice el bloque de pendientes, no una suma aparte.
      deudaAcumulada: pendientes.totalSinCobrar.monto,
      ingresosMes: ingresosMes._sum.tarifaCobrada ?? 0,
    };

    const data: DashboardData = {
      inicio: {
        tarifaCargada: (config?.tarifaDefault ?? 0) > 0,
        tienePacientes: pacientesActivos > 0,
        tieneTurnos: totalTurnos > 0,
      },
      kpis,
      sesionesHoy,
      deudores,
      proximaSesion:
        sesionesHoy.find((turno) => turno.fecha.getTime() >= now.getTime()) ??
        null,
      pendientes,
      riesgoDelDia: sesionesDelDia.map((sesion) =>
        aSenalDeRiesgo(sesion.datosEstructurados),
      ),
    };

    return ok(data);
  } catch (error) {
    return errorResponse(error);
  }
}
