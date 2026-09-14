// Eliminar: solo desde `fallida`. Borra la fila entera (transcripción, nota
// IA, feedback, segmentos por cascada) y libera el turno para volver a
// grabar. El audio en R2 se borra después, con reintentos: en la MISMA
// transacción queda el trabajo `borrar_audio_r2` con el prefijo y los
// índices, porque los segmentos se van de la base junto con la sesión y el
// trabajo no puede volver a leerlos.
//
// El DELETE lleva el estado de partida y la organización en el WHERE; si
// count = 0 la transacción se deshace y el trabajo no queda.

import { prefijoAudio } from "@/lib/sesion-clinica/estados";

import type { EventoAuditoriaInput } from "../../auditoria-pura";
import { ApiError } from "../../responses";
import { crearTrabajo } from "../trabajos/crear";

import type { ClienteTransaccional } from "./transicion";

export interface EliminarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export interface SesionEliminada {
  eliminada: true;
  /** Si quedó un trabajo de borrado del audio pendiente. */
  audioPorBorrar: boolean;
}

export async function eliminarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  registrarAuditoria,
}: EliminarSesionInput): Promise<SesionEliminada> {
  const resultado = await prisma.$transaction(async (tx) => {
    const existente = await tx.sesionClinica.findFirst({
      where: { id: sesionId, organizationId },
      select: {
        estado: true,
        audioEstado: true,
        turno: { select: { pacienteId: true } },
        segmentos: { select: { indice: true }, orderBy: { indice: "asc" } },
      },
    });
    if (!existente) throw new ApiError("Sesión clínica no encontrada", 404);
    if (existente.estado !== "fallida") {
      throw new ApiError("Solo se puede eliminar una sesión fallida", 409);
    }

    const audioPorBorrar = existente.audioEstado === "en_r2";
    if (audioPorBorrar) {
      await crearTrabajo({
        prisma: tx,
        tipo: "borrar_audio_r2",
        payload: {
          prefijo: prefijoAudio(organizationId, sesionId),
          indices: existente.segmentos.map((s) => s.indice),
        },
        organizationId,
        sesionId,
        pacienteId: existente.turno.pacienteId,
      });
    }

    const { count } = await tx.sesionClinica.deleteMany({
      where: { id: sesionId, organizationId, estado: "fallida" },
    });
    if (count === 0) {
      throw new ApiError(
        "La sesión cambió mientras se procesaba el pedido. Volvé a abrirla.",
        409,
      );
    }
    return { audioPorBorrar, segmentos: existente.segmentos.length };
  });

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.eliminar",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: {
      audioPorBorrar: resultado.audioPorBorrar,
      segmentos: resultado.segmentos,
    },
  });

  return { eliminada: true, audioPorBorrar: resultado.audioPorBorrar };
}
