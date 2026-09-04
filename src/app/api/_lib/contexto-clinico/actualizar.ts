// Escritura del Golden Thread: upsert del PATCH.
//
// Si no existe lo crea (version 1); si existe mergea sólo los campos enviados
// y bumpea `version`. Lo único que depende del actor:
//   - terapeuta (UI): `aprobadoPorTerapeutaEn = now()`. La acción humana ES
//     la revisión.
//   - worker (Llamada B del Golden Thread): `aprobadoPorTerapeutaEn = null`.
//     Es una sugerencia automática que la terapeuta tiene que revisar antes
//     de que el contexto se considere canónico; la UI muestra "sugerencia
//     pendiente" mientras está null.

import type { Prisma } from "@prisma/client";

import { cifrarContexto } from "@/lib/prisma-encryption";

import { cargarContexto } from "./cargar";
import type {
  ActorContexto,
  CambiosContexto,
  ClientePrisma,
  ContextoPayload,
} from "./tipos";

export interface ResultadoActualizacion {
  /** Versión resultante (para auditoría). */
  version: number;
  /** Contexto releído tras el upsert, en la misma forma que el GET. */
  contexto: ContextoPayload;
}

export async function actualizarContexto({
  prisma,
  pacienteId,
  organizationId,
  cambios,
  actor,
}: {
  prisma: ClientePrisma;
  pacienteId: string;
  organizationId: string;
  cambios: CambiosContexto;
  actor: ActorContexto;
}): Promise<ResultadoActualizacion> {
  const aprobadoPorTerapeutaEn = actor.tipo === "terapeuta" ? new Date() : null;

  // Para upsert necesitamos saber si existe (para bumpear version).
  const existente = await prisma.pacienteContextoClinico.findUnique({
    where: { pacienteId },
    select: { id: true, version: true },
  });
  const version = (existente?.version ?? 0) + 1;

  // Los tres campos PHI van cifrados vía cifrarContexto: lo que viene
  // undefined no toca su columna (merge parcial). riesgosHistoricos se
  // serializa a JSON dentro de cifrarContexto.
  const update: Prisma.PacienteContextoClinicoUpdateInput = {
    aprobadoPorTerapeutaEn,
    version,
    ...cifrarContexto({
      hipotesisDiagnostica: cambios.hipotesisDiagnostica,
      resumenAcumulativo: cambios.resumenAcumulativo,
      riesgosHistoricos: cambios.riesgosHistoricos,
    }),
  };
  if (cambios.objetivosTerapeuticos !== undefined) {
    update.objetivosTerapeuticos = cambios.objetivosTerapeuticos;
  }
  if (cambios.intervencionesProbadas !== undefined) {
    update.intervencionesProbadas = cambios.intervencionesProbadas;
  }
  if (cambios.temasRecurrentes !== undefined) {
    update.temasRecurrentes = cambios.temasRecurrentes;
  }
  if (cambios.ultimaSesionId !== undefined) {
    update.ultimaSesionId = cambios.ultimaSesionId;
  }

  await prisma.pacienteContextoClinico.upsert({
    where: { pacienteId },
    update,
    create: {
      paciente: { connect: { id: pacienteId } },
      organization: { connect: { id: organizationId } },
      objetivosTerapeuticos: cambios.objetivosTerapeuticos ?? [],
      intervencionesProbadas: cambios.intervencionesProbadas ?? [],
      temasRecurrentes: cambios.temasRecurrentes ?? [],
      ultimaSesionId: cambios.ultimaSesionId ?? null,
      version: 1,
      aprobadoPorTerapeutaEn,
      ...cifrarContexto({
        hipotesisDiagnostica: cambios.hipotesisDiagnostica ?? null,
        resumenAcumulativo: cambios.resumenAcumulativo ?? null,
        riesgosHistoricos: cambios.riesgosHistoricos ?? null,
      }),
    },
  });

  // Releer con cargarContexto para devolver la forma de GET (incluye
  // ultimasNotas y totalSesionesAprobadas; la UI no hace un segundo fetch).
  const contexto = await cargarContexto({ prisma, pacienteId, organizationId });
  return { version, contexto };
}
