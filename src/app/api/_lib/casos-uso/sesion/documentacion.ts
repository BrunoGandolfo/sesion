// El historial clínico de la ficha: las notas en revisión o aprobadas de una
// paciente, paginadas. Vivía en GET /api/pacientes/[id]/documentacion, con la
// consulta en la ruta.
//
// Devuelve notas completas en lote: cuenta como EXPORTACIÓN de documentación
// clínica, y por eso el rastro (sesion.exportar) va con `auditar` en la misma
// transacción que la lectura: si no se puede escribir, las notas no salen (la
// usuaria ve un error y vuelve a pedirlas). Es el mismo criterio que
// hilo/exportar.ts y sesion/ver.ts.

import type { EstadoSesion } from "@prisma/client";

import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";

import { auditar } from "../../auditoria";
import { requirePaciente } from "../../pacientes";

/** Los estados que este historial muestra: lo que la profesional dio por
 *  bueno o está por darlo. */
const ESTADOS: EstadoSesion[] = ["revision", "aprobada"];

export interface ExportarDocumentacionInput {
  prisma: typeof db;
  organizationId: string;
  pacienteId: string;
  usuarioId: string;
  page: number;
  limit: number;
}

export async function exportarDocumentacion({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  page,
  limit,
}: ExportarDocumentacionInput) {
  return prisma.$transaction(async (tx) => {
    await requirePaciente(tx, pacienteId, organizationId);

    const where = {
      organizationId,
      estado: { in: ESTADOS },
      turno: { pacienteId },
    };

    const totalSesiones = await tx.sesionClinica.count({ where });
    const sesiones = await tx.sesionClinica.findMany({
      where,
      orderBy: { turno: { fecha: "desc" } },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        estado: true,
        duracionAudioSeg: true,
        procesadaEn: true,
        aprobadaEn: true,
        // Campos lógicos de la extensión de cifrado (prisma-encryption.ts).
        notaIa: true,
        notaFinal: true,
        datos: true,
        feedback: true,
        feedbackEstado: true,
        turno: {
          select: {
            id: true,
            fecha: true,
            duracion: true,
            modalidad: true,
          },
        },
      },
    });

    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.sesion.exportar,
      entidad: "paciente",
      entidadId: pacienteId,
      // La página entra al rastro: exportar una página y exportar todo no
      // son el mismo acto, y el registro tiene que poder distinguirlos.
      detalle: { page, limit, total: totalSesiones },
    });

    return {
      pacienteId,
      totalSesiones,
      sesiones: sesiones.map((s) => ({
        sesionClinicaId: s.id,
        turnoId: s.turno.id,
        fecha: s.turno.fecha.toISOString(),
        duracionMin: s.turno.duracion,
        duracionAudioSeg: s.duracionAudioSeg,
        modalidad: s.turno.modalidad,
        estado: s.estado,
        // La nota vigente: la aprobada si existe, si no la de la IA.
        nota: s.notaFinal ?? s.notaIa,
        // Parseo del tablero (valida el shape; fila corrupta → null).
        datos: parseDatosEstructurados(s.datos),
        // Su forma la valida quien lo dibuja (hayParaVos).
        feedback: s.feedback,
        feedbackEstado: s.feedbackEstado,
        aprobadaEn: s.aprobadaEn ? s.aprobadaEn.toISOString() : null,
        procesadaEn: s.procesadaEn ? s.procesadaEn.toISOString() : null,
      })),
      page,
      totalPages: totalSesiones === 0 ? 0 : Math.ceil(totalSesiones / limit),
    };
  });
}
