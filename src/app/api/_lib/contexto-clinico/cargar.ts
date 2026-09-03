// Lectura del Golden Thread desde la base y armado del ContextoPayload.

import { ApiError } from "../responses";
import {
  contextoVacio,
  type ClientePrisma,
  type ContextoPayload,
  type Intervencion,
  type NotaResumen,
  type Objetivo,
  type RiesgoHistorico,
  type Tema,
} from "./tipos";

const ULTIMAS_NOTAS_LIMIT = 3;

// Prisma devuelve `Prisma.JsonValue` para columnas Json. La forma la garantiza
// la spec del modelo + el Zod del PATCH; al leer asumimos consistencia y caemos
// a array vacío si la forma se rompe (datos corruptos en DB).
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function cargarContexto({
  prisma,
  pacienteId,
  organizationId,
}: {
  prisma: ClientePrisma;
  pacienteId: string;
  organizationId: string;
}): Promise<ContextoPayload> {
  const [contextoRaw, ultimasNotas, totalAprobadas] = await Promise.all([
    prisma.pacienteContextoClinico.findUnique({
      where: { pacienteId },
      select: {
        hipotesisDiagnostica: true,
        resumenAcumulativo: true,
        objetivosTerapeuticos: true,
        intervencionesProbadas: true,
        temasRecurrentes: true,
        riesgosHistoricos: true,
        ultimaSesionId: true,
        version: true,
        aprobadoPorTerapeutaEn: true,
        creadoEn: true,
        actualizadoEn: true,
        organizationId: true,
      },
    }),
    prisma.sesionClinica.findMany({
      where: {
        organizationId,
        estado: "aprobado",
        turno: { pacienteId },
      },
      orderBy: { turno: { fecha: "desc" } },
      take: ULTIMAS_NOTAS_LIMIT,
      select: {
        id: true,
        notaAnalisis: true,
        notaPlan: true,
        turno: { select: { fecha: true } },
      },
    }),
    prisma.sesionClinica.count({
      where: {
        organizationId,
        estado: "aprobado",
        turno: { pacienteId },
      },
    }),
  ]);

  // Defensa: el findUnique no scopea por org (el FK al paciente lo garantiza);
  // si igual apareciera un contexto de otra org, abortar.
  if (contextoRaw && contextoRaw.organizationId !== organizationId) {
    throw new ApiError("Contexto pertenece a otra organización", 403);
  }

  const notasResumen: NotaResumen[] = ultimasNotas.map((s, idx) => ({
    sesionClinicaId: s.id,
    numero: idx + 1,
    fechaSesion: s.turno.fecha.toISOString(),
    notaAnalisis: s.notaAnalisis ?? null,
    notaPlan: s.notaPlan ?? null,
  }));

  if (!contextoRaw) {
    const vacio = contextoVacio(pacienteId);
    vacio.ultimasNotas = notasResumen;
    vacio.totalSesionesAprobadas = totalAprobadas;
    return vacio;
  }

  return {
    pacienteId,
    hipotesisDiagnostica: contextoRaw.hipotesisDiagnostica ?? null,
    resumenAcumulativo: contextoRaw.resumenAcumulativo ?? null,
    objetivosTerapeuticos: asArray<Objetivo>(contextoRaw.objetivosTerapeuticos),
    intervencionesProbadas: asArray<Intervencion>(
      contextoRaw.intervencionesProbadas,
    ),
    temasRecurrentes: asArray<Tema>(contextoRaw.temasRecurrentes),
    riesgosHistoricos: asArray<RiesgoHistorico>(contextoRaw.riesgosHistoricos),
    ultimaSesionId: contextoRaw.ultimaSesionId,
    version: contextoRaw.version,
    aprobadoPorTerapeutaEn:
      contextoRaw.aprobadoPorTerapeutaEn?.toISOString() ?? null,
    creadoEn: contextoRaw.creadoEn.toISOString(),
    actualizadoEn: contextoRaw.actualizadoEn.toISOString(),
    ultimasNotas: notasResumen,
    totalSesionesAprobadas: totalAprobadas,
  };
}
