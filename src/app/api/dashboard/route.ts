import { db } from "@/lib/db";
import type { DeudaPaciente, KPIsDashboard } from "@/types/domain";

import { getOrganizationId } from "../_lib/auth";
import {
  addDays,
  buscarTurnosConDeuda,
  calcularDeudores,
  DashboardData,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeekMonday,
  sumTarifas,
  toTurnoConPaciente,
} from "../_lib/domain";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPE_DEUDORES = 10;

export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const weekStart = startOfWeekMonday(now);
    const weekEnd = endOfDay(addDays(weekStart, 6));

    const [
      pacientesActivos,
      sesionesHoyCount,
      turnosConDeuda,
      ingresosMes,
      sesionesHoyRows,
      sesionesSemanaRows,
    ] = await Promise.all([
      db.paciente.count({
        where: { organizationId, activo: true },
      }),
      db.turno.count({
        where: {
          organizationId,
          fecha: { gte: todayStart, lte: todayEnd },
          estado: { not: "cancelado" },
        },
      }),
      // Una sola lectura de la deuda: alimenta el KPI y el ranking.
      buscarTurnosConDeuda(db, organizationId),
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
      db.turno.findMany({
        where: {
          organizationId,
          fecha: { gte: weekStart, lte: weekEnd },
          estado: { not: "cancelado" },
        },
        select: { fecha: true },
      }),
    ]);

    const sesionesHoy = sesionesHoyRows.map(toTurnoConPaciente);

    // Más viejos primero — la deuda añeja es la que "duele". A igualdad de
    // días de atraso, desempata por monto descendente. Top 10.
    const deudores: DeudaPaciente[] = calcularDeudores(turnosConDeuda, now)
      .map((d) => ({
        pacienteId: d.pacienteId,
        nombre: d.nombre,
        apellido: d.apellido,
        sesionesImpagas: d.sesionesImpagas,
        montoTotal: d.montoTotal,
        diasAtraso: d.diasAtraso ?? 0,
      }))
      .sort((a, b) =>
        b.diasAtraso !== a.diasAtraso
          ? b.diasAtraso - a.diasAtraso
          : b.montoTotal - a.montoTotal,
      )
      .slice(0, TOPE_DEUDORES);

    const sesionesSemana = Array.from({ length: 7 }, () => 0);
    for (const turno of sesionesSemanaRows) {
      const dayIndex = (turno.fecha.getDay() + 6) % 7;
      sesionesSemana[dayIndex] += 1;
    }

    const kpis: KPIsDashboard = {
      pacientesActivos,
      sesionesHoy: sesionesHoyCount,
      deudaAcumulada: sumTarifas(turnosConDeuda),
      ingresosMes: ingresosMes._sum.tarifaCobrada ?? 0,
    };

    const data: DashboardData = {
      kpis,
      sesionesHoy,
      deudores,
      proximaSesion:
        sesionesHoy.find((turno) => turno.fecha.getTime() >= now.getTime()) ??
        null,
      sesionesSemana,
    };

    return ok(data);
  } catch (error) {
    return errorResponse(error);
  }
}
