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

  const update: Prisma.PacienteContextoClinicoUpdateInput = {
    aprobadoPorTerapeutaEn,
    version,
  };
  if (cambios.hipotesisDiagnostica !== undefined) {
    update.hipotesisDiagnostica = cambios.hipotesisDiagnostica;
  }
  if (cambios.resumenAcumulativo !== undefined) {
    update.resumenAcumulativo = cambios.resumenAcumulativo;
  }
  if (cambios.objetivosTerapeuticos !== undefined) {
    update.objetivosTerapeuticos = cambios.objetivosTerapeuticos;
  }
  if (cambios.intervencionesProbadas !== undefined) {
    update.intervencionesProbadas = cambios.intervencionesProbadas;
  }
  if (cambios.temasRecurrentes !== undefined) {
    update.temasRecurrentes = cambios.temasRecurrentes;
  }
  if (cambios.riesgosHistoricos !== undefined) {
    // La columna es String? @db.Text: se stringifica antes de Prisma. La
    // extensión de cifrado acepta strings y los cifra tal cual; al leer
    // reparsea a array. Mismo patrón que callback/route.ts.
    update.riesgosHistoricos = JSON.stringify(cambios.riesgosHistoricos);
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
      hipotesisDiagnostica: cambios.hipotesisDiagnostica ?? null,
      resumenAcumulativo: cambios.resumenAcumulativo ?? null,
      objetivosTerapeuticos: cambios.objetivosTerapeuticos ?? [],
      intervencionesProbadas: cambios.intervencionesProbadas ?? [],
      temasRecurrentes: cambios.temasRecurrentes ?? [],
      riesgosHistoricos: cambios.riesgosHistoricos
        ? JSON.stringify(cambios.riesgosHistoricos)
        : null,
      ultimaSesionId: cambios.ultimaSesionId ?? null,
      version: 1,
      aprobadoPorTerapeutaEn,
    },
  });

  // Releer con cargarContexto para devolver la forma de GET (incluye
  // ultimasNotas y totalSesionesAprobadas; la UI no hace un segundo fetch).
  const contexto = await cargarContexto({ prisma, pacienteId, organizationId });
  return { version, contexto };
}
