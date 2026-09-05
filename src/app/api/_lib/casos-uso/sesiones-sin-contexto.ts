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

/**
 * Regla ÚNICA de "esta sesión ya está integrada al hilo".
 *
 * Está acá y no repetida en cada consumidor porque la usan dos cosas que
 * tienen que contestar lo mismo: el batch que el worker pide para integrar y
 * la métrica de salud que cuenta las que quedaron atrás. Si una dijera que
 * una sesión está integrada y la otra que no, el monitoreo alertaría para
 * siempre por algo que el worker nunca va a tomar.
 *
 * `aprobadoEnUltima` es el aprobadoEn de la sesión a la que apunta
 * `ultimaSesionId`, o null si esa sesión ya no existe. En ese caso no se
 * excluye nada: en el peor caso se re-integra una vez.
 */
export function estaIntegrada(
  sesion: { id: string; aprobadoEn: Date | null },
  contexto: { ultimaSesionId: string | null } | null,
  aprobadoEnUltima: Date | null,
): boolean {
  if (!contexto?.ultimaSesionId) return false;
  if (contexto.ultimaSesionId === sesion.id) return true;
  if (!aprobadoEnUltima || !sesion.aprobadoEn) return false;
  return sesion.aprobadoEn.getTime() <= aprobadoEnUltima.getTime();
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

    const integradaHasta = contexto?.ultimaSesionId
      ? (aprobadoEnPorSesion.get(contexto.ultimaSesionId) ?? null)
      : null;
    if (estaIntegrada(s, contexto, integradaHasta)) continue;

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

// ────────────────────────────────────────────────────────────────────────────
// Métrica de salud: lo que quedó atrás
// ────────────────────────────────────────────────────────────────────────────

/** Tope de filas que mira la métrica. Pasado ese número el número deja de
 *  ser exacto y lo que importa es que hay un problema, no cuán grande. */
export const TOPE_ATRASADAS = 200;

export interface SesionesAtrasadasParams {
  prisma: ClientePrisma;
  /** Se cuentan las sesiones aprobadas ANTES de este instante. */
  hasta: Date;
  tope?: number;
}

export interface SesionesAtrasadas {
  /** Cuántas sesiones aprobadas antes de `hasta` siguen sin integrarse. */
  cantidad: number;
  /** true si se llegó al tope: `cantidad` es un piso, no el total. */
  saturado: boolean;
}

/**
 * Sesiones aprobadas hace rato que el Golden Thread todavía no integró.
 *
 * Es la señal de que la Llamada B del worker dejó de correr: la nota se
 * aprobó, el audio se borró, y el hilo del proceso —lo que la profesional lee
 * antes de la próxima sesión— se quedó en la sesión anterior sin que nada lo
 * avise. Hasta ahora el cron de salud miraba el pipeline hasta "procesando" y
 * los recordatorios, pero no este tramo.
 *
 * Misma regla de "integrada" que el batch que consume el worker
 * (estaIntegrada), para que las dos cosas no puedan discrepar.
 */
export async function contarSesionesSinContextoAtrasadas({
  prisma,
  hasta,
  tope = TOPE_ATRASADAS,
}: SesionesAtrasadasParams): Promise<SesionesAtrasadas> {
  const candidatas = await prisma.sesionClinica.findMany({
    where: { estado: "aprobado", aprobadoEn: { lt: hasta } },
    orderBy: { aprobadoEn: "asc" },
    take: tope,
    select: {
      id: true,
      aprobadoEn: true,
      turno: { select: { pacienteId: true } },
    },
  });

  if (candidatas.length === 0) return { cantidad: 0, saturado: false };

  const pacienteIds = [...new Set(candidatas.map((s) => s.turno.pacienteId))];

  const contextos = await prisma.pacienteContextoClinico.findMany({
    where: { pacienteId: { in: pacienteIds } },
    select: { pacienteId: true, ultimaSesionId: true },
  });
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

  let cantidad = 0;
  for (const s of candidatas) {
    const contexto = contextoPorPaciente.get(s.turno.pacienteId) ?? null;
    const integradaHasta = contexto?.ultimaSesionId
      ? (aprobadoEnPorSesion.get(contexto.ultimaSesionId) ?? null)
      : null;
    if (!estaIntegrada(s, contexto, integradaHasta)) cantidad += 1;
  }

  return { cantidad, saturado: candidatas.length === tope };
}
