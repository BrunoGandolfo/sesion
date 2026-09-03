// Caso de uso: sesiones aprobadas que todavía no fueron integradas al
// PacienteContextoClinico (Golden Thread, Llamada B del worker).
//
// Devuelve como máximo `limite` sesiones y UNA por paciente (la más antigua),
// para que el worker las integre en orden. "Integrada" = el contexto apunta
// a esta sesión (ultimaSesionId), o la sesión se aprobó antes (o al mismo
// tiempo) que la sesión a la que apunta ultimaSesionId. No se usa
// contexto.actualizadoEn: lo mueve también la edición manual de la terapeuta
// y la propia integración, y con dos aprobaciones seguidas dejaría la
// segunda fuera para siempre.
//
// Sin request ni Response: recibe prisma y la fecha de corte como parámetros.

import type { db } from "@/lib/db";
import { ensamblarNotaSOAP } from "@/lib/sesion-clinica-utils";

import { parseDatosEstructuradosRaw, sinClaveTemporal } from "../sesion-clinica";

type ClientePrisma = typeof db;

export interface SesionesSinContextoParams {
  prisma: ClientePrisma;
  /** Solo sesiones aprobadas desde esta fecha (inclusive). */
  desde: Date;
  /** Máximo de sesiones devueltas. */
  limite: number;
  /** Si se indica, restringe a esa organización. */
  organizationId?: string;
}

export interface ContextoActual {
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  objetivosTerapeuticos: unknown;
  intervencionesProbadas: unknown;
  temasRecurrentes: unknown;
  riesgosHistoricos: unknown[];
  ultimaSesionId: string | null;
  version: number;
}

export interface SesionSinContexto {
  sesionClinicaId: string;
  pacienteId: string;
  fechaSesion: string;
  numeroSesion: number;
  nota: {
    subjetivo: string;
    objetivo: string;
    analisis: string;
    plan: string;
  };
  datosEstructurados: Record<string, unknown> | null;
  contextoActual: ContextoActual | null;
}

// Cuántas aprobadas se miran para armar el batch: más que `limite` porque
// varias candidatas pueden ser del mismo paciente o estar ya integradas.
const TOMAR_CANDIDATAS = 20;

const NOTA_VACIA = { subjetivo: "", objetivo: "", analisis: "", plan: "" };

function parseRiesgosHistoricos(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function sesionesSinContexto({
  prisma,
  desde,
  limite,
  organizationId,
}: SesionesSinContextoParams): Promise<SesionSinContexto[]> {
  const candidatas = await prisma.sesionClinica.findMany({
    where: {
      estado: "aprobado",
      aprobadoEn: { gte: desde },
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { aprobadoEn: "asc" },
    take: TOMAR_CANDIDATAS,
    select: {
      id: true,
      aprobadoEn: true,
      organizationId: true,
      notaSubjetivo: true,
      notaObjetivo: true,
      notaAnalisis: true,
      notaPlan: true,
      datosEstructurados: true,
      turno: { select: { fecha: true, pacienteId: true } },
    },
  });

  // Tres consultas agrupadas ANTES del loop: contextos de los pacientes del
  // batch, la sesión a la que apunta cada ultimaSesionId (para saber hasta
  // dónde se integró), y las sesiones aprobadas de esos pacientes (para
  // numerar en memoria).
  const pacienteIds = [...new Set(candidatas.map((s) => s.turno.pacienteId))];

  const contextos = pacienteIds.length
    ? await prisma.pacienteContextoClinico.findMany({
        where: { pacienteId: { in: pacienteIds } },
        select: {
          pacienteId: true,
          ultimaSesionId: true,
          hipotesisDiagnostica: true,
          resumenAcumulativo: true,
          objetivosTerapeuticos: true,
          intervencionesProbadas: true,
          temasRecurrentes: true,
          riesgosHistoricos: true,
          version: true,
        },
      })
    : [];
  const contextoPorPaciente = new Map(contextos.map((c) => [c.pacienteId, c]));

  const ultimaIds = contextos
    .map((c) => c.ultimaSesionId)
    .filter((id): id is string => id !== null);
  const ultimas = ultimaIds.length
    ? await prisma.sesionClinica.findMany({
        where: { id: { in: ultimaIds } },
        select: { id: true, aprobadoEn: true },
      })
    : [];
  const aprobadoEnPorSesion = new Map(ultimas.map((u) => [u.id, u.aprobadoEn]));

  const aprobadasDePacientes = pacienteIds.length
    ? await prisma.sesionClinica.findMany({
        where: {
          estado: "aprobado",
          turno: { pacienteId: { in: pacienteIds } },
        },
        select: {
          organizationId: true,
          turno: { select: { pacienteId: true, fecha: true } },
        },
      })
    : [];

  const pacientesIncluidos = new Set<string>();
  const resultado: SesionSinContexto[] = [];

  for (const s of candidatas) {
    if (resultado.length >= limite) break;

    const pacienteId = s.turno.pacienteId;
    // Una sola sesión por paciente por respuesta (la más antigua, por el
    // orderBy): la siguiente se entrega cuando esta ya esté integrada.
    if (pacientesIncluidos.has(pacienteId)) continue;

    const contexto = contextoPorPaciente.get(pacienteId) ?? null;

    // Ya integrada: el contexto apunta a esta sesión, o esta sesión se
    // aprobó antes que la última integrada. Si ultimaSesionId apunta a una
    // sesión que ya no existe, no se excluye nada: en el peor caso se
    // re-integra una vez desde `desde`.
    if (contexto?.ultimaSesionId === s.id) continue;
    const integradaHasta = contexto?.ultimaSesionId
      ? (aprobadoEnPorSesion.get(contexto.ultimaSesionId) ?? null)
      : null;
    if (
      integradaHasta &&
      s.aprobadoEn &&
      s.aprobadoEn.getTime() <= integradaHasta.getTime()
    ) {
      continue;
    }

    // Numeración: aprobadas de la misma organización y paciente con fecha de
    // turno hasta la de esta sesión (inclusive).
    const numeroSesion = aprobadasDePacientes.filter(
      (a) =>
        a.organizationId === s.organizationId &&
        a.turno.pacienteId === pacienteId &&
        a.turno.fecha.getTime() <= s.turno.fecha.getTime(),
    ).length;

    pacientesIncluidos.add(pacienteId);
    resultado.push({
      sesionClinicaId: s.id,
      pacienteId,
      fechaSesion: s.turno.fecha.toISOString(),
      numeroSesion,
      nota:
        ensamblarNotaSOAP({
          subjetivo: s.notaSubjetivo,
          objetivo: s.notaObjetivo,
          analisis: s.notaAnalisis,
          plan: s.notaPlan,
        }) ?? NOTA_VACIA,
      datosEstructurados: sinClaveTemporal({
        datosEstructurados: parseDatosEstructuradosRaw(s.datosEstructurados),
      }).datosEstructurados,
      contextoActual: contexto
        ? {
            hipotesisDiagnostica: contexto.hipotesisDiagnostica ?? null,
            resumenAcumulativo: contexto.resumenAcumulativo ?? null,
            objetivosTerapeuticos: contexto.objetivosTerapeuticos,
            intervencionesProbadas: contexto.intervencionesProbadas,
            temasRecurrentes: contexto.temasRecurrentes,
            riesgosHistoricos: parseRiesgosHistoricos(contexto.riesgosHistoricos),
            ultimaSesionId: contexto.ultimaSesionId,
            version: contexto.version,
          }
        : null,
    });
  }

  return resultado;
}
