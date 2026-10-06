// Eliminar: solo desde `fallida`. Borra la fila entera (transcripción, nota
// IA, feedback) y libera el turno para volver a grabar. El audio en R2 se
// borra después, con reintentos: en la MISMA transacción queda el trabajo
// `borrar_audio_r2` con el prefijo y el índice del archivo, porque la sesión
// se va de la base y el trabajo no puede volver a leerla.
//
// El DELETE lleva el estado de partida y la organización en el WHERE (el de
// la tabla, `whereTransicion({ operacion: "eliminar" })`); si count = 0 la
// transacción se deshace y el trabajo no queda.

import { registrarAuditoria } from "../../auditoria";
import { ApiError } from "../../responses";
import { trabajoBorrarAudio } from "../trabajos/crear";

import {
  exigirEstado,
  MENSAJE_CONFLICTO,
  MENSAJE_NO_ENCONTRADA,
  whereTransicion,
  type ClienteTransaccional,
} from "./transicion";
import { ACCIONES } from "@/lib/auditoria-acciones";

export interface EliminarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
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
}: EliminarSesionInput): Promise<SesionEliminada> {
  const resultado = await prisma.$transaction(async (tx) => {
    const existente = await tx.sesionClinica.findFirst({
      where: { id: sesionId, organizationId },
      select: {
        estado: true,
        audioEstado: true,
        turno: { select: { pacienteId: true } },
      },
    });
    if (!existente) throw new ApiError(MENSAJE_NO_ENCONTRADA, 404);
    exigirEstado(existente.estado, "eliminar", "Solo se puede eliminar una sesión fallida");

    const audioPorBorrar = existente.audioEstado === "en_r2";
    if (audioPorBorrar) {
      await trabajoBorrarAudio(tx, { organizationId, sesionId, pacienteId: existente.turno.pacienteId });
    }

    const { count } = await tx.sesionClinica.deleteMany({
      where: whereTransicion({ operacion: "eliminar", sesionId, organizationId }),
    });
    if (count === 0) throw new ApiError(MENSAJE_CONFLICTO, 409);
    return { audioPorBorrar };
  });

  await registrarAuditoria(prisma, {
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: ACCIONES.sesion.eliminar,
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: {
      audioPorBorrar: resultado.audioPorBorrar,
    },
  });

  return { eliminada: true, audioPorBorrar: resultado.audioPorBorrar };
}
