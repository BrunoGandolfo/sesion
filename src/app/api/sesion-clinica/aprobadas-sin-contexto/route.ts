// Endpoint M2M: lo consume el worker Python (processor/) para la Llamada B
// del Golden Thread (integrar cada sesión aprobada al contexto longitudinal
// del paciente). Se autentica con PROCESSING_SECRET (Bearer token); está
// excluido del matcher de auth en src/middleware.ts.
//
// Devuelve sesiones aprobadas desde CONTEXTO_DESDE que todavía no fueron
// integradas al PacienteContextoClinico: como máximo 5 por respuesta y UNA
// por paciente (la más antigua), para que el worker las integre en orden.
// "Integrada" = contexto.ultimaSesionId === sesión, o la sesión se aprobó
// antes (o al mismo tiempo) que la sesión a la que apunta ultimaSesionId.
// No se usa contexto.actualizadoEn: lo mueve también la edición manual de
// la terapeuta y la propia integración, y con dos aprobaciones seguidas
// dejaría la segunda fuera para siempre.

import { db } from "@/lib/db";
import { ensamblarNotaSOAP } from "@/lib/sesion-clinica-utils";

import { requireM2M } from "../../_lib/auth";
import { errorResponse } from "../../_lib/responses";
import {
  parseDatosEstructuradosRaw,
  sinClaveTemporal,
} from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAKE_CANDIDATAS = 20;
const MAX_RESULTADOS = 5;

const NOTA_VACIA = { subjetivo: "", objetivo: "", analisis: "", plan: "" };

// Fecha de corte: CONTEXTO_DESDE (ISO). Si falta o no parsea, el inicio del
// día de hoy (hora local del server) — así un deploy sin la env no dispara
// la integración retroactiva de todo el histórico.
function fechaCorte(): Date {
  const raw = process.env.CONTEXTO_DESDE;
  if (raw && raw.trim() !== "") {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

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

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const desde = fechaCorte();

    const candidatas = await db.sesionClinica.findMany({
      where: { estado: "aprobado", aprobadoEn: { gte: desde } },
      orderBy: { aprobadoEn: "asc" },
      take: TAKE_CANDIDATAS,
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

    // Tres consultas agrupadas ANTES del loop (antes eran tres por
    // candidata): contextos de los pacientes del batch, la sesión a la que
    // apunta cada ultimaSesionId (para saber hasta dónde se integró), y las
    // sesiones aprobadas de esos pacientes (para numerar en memoria).
    const pacienteIds = [...new Set(candidatas.map((s) => s.turno.pacienteId))];

    const contextos = pacienteIds.length
      ? await db.pacienteContextoClinico.findMany({
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
    const contextoPorPaciente = new Map(
      contextos.map((c) => [c.pacienteId, c]),
    );

    const ultimaIds = contextos
      .map((c) => c.ultimaSesionId)
      .filter((id): id is string => id !== null);
    const ultimas = ultimaIds.length
      ? await db.sesionClinica.findMany({
          where: { id: { in: ultimaIds } },
          select: { id: true, aprobadoEn: true },
        })
      : [];
    const aprobadoEnPorSesion = new Map(
      ultimas.map((u) => [u.id, u.aprobadoEn]),
    );

    const aprobadasDePacientes = pacienteIds.length
      ? await db.sesionClinica.findMany({
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
    const resultado: Array<{
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
      contextoActual: null | {
        hipotesisDiagnostica: string | null;
        resumenAcumulativo: string | null;
        objetivosTerapeuticos: unknown;
        intervencionesProbadas: unknown;
        temasRecurrentes: unknown;
        riesgosHistoricos: unknown[];
        ultimaSesionId: string | null;
        version: number;
      };
    }> = [];

    for (const s of candidatas) {
      if (resultado.length >= MAX_RESULTADOS) break;

      const pacienteId = s.turno.pacienteId;
      // Una sola sesión por paciente por respuesta (la más antigua, por el
      // orderBy): la siguiente se entrega cuando esta ya esté integrada.
      if (pacientesIncluidos.has(pacienteId)) continue;

      const contexto = contextoPorPaciente.get(pacienteId) ?? null;

      // Ya integrada: el contexto apunta a esta sesión, o esta sesión se
      // aprobó antes que la última integrada (el worker integra en orden de
      // aprobación, una por paciente por ciclo). Si ultimaSesionId apunta a
      // una sesión que ya no existe, no se excluye nada: en el peor caso se
      // re-integra una vez desde CONTEXTO_DESDE.
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

      // Misma regla que el count previo: aprobadas de la misma organización
      // y paciente con fecha de turno hasta la de esta sesión (inclusive).
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
              riesgosHistoricos: parseRiesgosHistoricos(
                contexto.riesgosHistoricos,
              ),
              ultimaSesionId: contexto.ultimaSesionId,
              version: contexto.version,
            }
          : null,
      });
    }

    return Response.json(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}
