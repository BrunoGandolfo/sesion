// Caso de uso: la pantalla Hoy. Compone lo que ya existe (la deuda de
// domain.ts, pendientes-terapeuta) con las lecturas sueltas que vivían en
// GET /api/dashboard. La ruta ahora solo llama.
//
// La señal de riesgo del día sale del campo lógico `datos` de la sesión
// clínica (anexo de docs/esquema.md: `sesiones_clinicas.datos_encrypted` →
// `datos`, descifrado por la extensión del área 3). Acá solo se leen dos
// claves, sin texto libre.

import type { db } from "@/lib/db";
import { finDelDiaMvd, inicioDelDiaMvd } from "@/lib/fechas-montevideo";
import { normalizarRiesgo } from "@/lib/sesion-clinica/normalizar";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";
import type { DashboardData, KPIsDashboard, SenalRiesgoDelDia } from "@/types/domain";

import { buscarTurnosConDeuda, cobradoEnMes, toTurnoConPaciente } from "../domain";
import { deudaDeHoy, pendientesTerapeuta } from "./pendientes-terapeuta";

type ClientePrisma = typeof db;

/** Cuántos deudores muestra Hoy; la lista completa vive en Cobros. */
export const TOPE_DEUDORES = 10;

/** Los dos campos que mira `clavesDeRiesgo`, sin el texto libre. La forma
 *  y el porqué están en `SenalRiesgoDelDia` (src/types/domain.ts).
 *
 *  Lee `datos` como lo leen aprobar y el brief: parseDatosEstructurados y
 *  normalizarRiesgo. Antes lo casteaba crudo y un `nivel` inválido guardado
 *  llegaba tal cual a Hoy; ahora llega como "ninguno", el mismo veredicto
 *  que da la aprobación. (El worker entrega `datos` ya validado contra el
 *  mismo schema, así que una fila real no se pierde por esto.) */
export function aSenalDeRiesgo(crudo: unknown): SenalRiesgoDelDia {
  const datos = parseDatosEstructurados(crudo);
  const flags = datos?.flagsRiesgo ?? null;
  return {
    riesgoDetectado: datos?.riesgoDetectado
      ? {
          nivel: normalizarRiesgo(datos.riesgoDetectado).nivel,
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

  // La deuda se lee y se cuenta UNA vez (deudaDeHoy) y la comparten el KPI,
  // la lista de "Te deben" y el bloque de pendientes. Antes se leía una vez
  // pero se contaba dos: acá y otra vez dentro de pendientesTerapeuta.
  const deuda = buscarTurnosConDeuda(prisma, organizationId).then((turnos) =>
    deudaDeHoy(turnos, ahora),
  );

  const [
    deudaCalculada,
    ingresosMes,
    sesionesHoyRows,
    pendientes,
    sesionesDelDia,
    config,
    pacientesActivos,
    totalTurnos,
  ] = await Promise.all([
    deuda,
    prisma.turno.aggregate({
      where: cobradoEnMes(organizationId, ahora),
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
    // le entra ya contada.
    deuda.then((d) => pendientesTerapeuta({ prisma, organizationId, ahora, deuda: d })),
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

  // La misma cuenta y el mismo orden que el bloque de pendientes y que
  // /api/deudores: monto descendente y, a igual monto, la deuda más vieja.
  const deudores = deudaCalculada.deudores.slice(0, TOPE_DEUDORES);

  const kpis: KPIsDashboard = {
    // Las mismas filas que se listan abajo: contarlas con otra consulta del
    // mismo `where` era una ida más a la base.
    sesionesHoy: sesionesHoyRows.length,
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
