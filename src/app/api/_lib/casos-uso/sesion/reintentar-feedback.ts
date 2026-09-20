// "Pedir de nuevo" Para vos: no toca la nota ni el estado de la sesión. Vale
// en `revision` y en `aprobada` (el feedback no es parte de la nota
// aprobada), cuando el feedback no salió (`fallido`) o nunca se pidió
// (`no_pedido`). Pasa el feedback a `pendiente` y crea `generar_feedback`
// en la misma transacción; el worker lo resuelve con la transcripción que
// la app le adjunta al entregarlo.

import type { EstadoFeedback } from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../auditoria";
import { ApiError } from "../../responses";
import type { FilaSesionClinica } from "../../sesion-clinica";
import { crearTrabajo } from "../trabajos/crear";

import { leerSesion } from "./leer";
import { transicionar, type ClienteTransaccional } from "./transicion";

/** Estados del feedback desde los que se puede pedir de nuevo. */
export const FEEDBACK_REPEDIBLE: ReadonlyArray<EstadoFeedback> = [
  "fallido",
  "no_pedido",
];

export interface ReintentarFeedbackInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
}

export async function reintentarFeedback({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
}: ReintentarFeedbackInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: { modeloAsr: true, generacion: true, turno: { select: { pacienteId: true } } },
  });
  if (!existente) throw new ApiError("Sesión clínica no encontrada", 404);
  if (existente.modeloAsr === null) {
    throw new ApiError(
      "La sesión todavía no tiene transcripción: no hay de dónde generar Para vos",
      409,
    );
  }
  const pacienteId = existente.turno.pacienteId;

  await prisma.$transaction(async (tx) => {
    await transicionar({
      prisma: tx,
      operacion: "reintentar_feedback",
      sesionId,
      organizationId,
      condiciones: { feedbackEstado: { in: [...FEEDBACK_REPEDIBLE] } },
      data: { feedbackEstado: "pendiente", feedbackError: null },
      conflicto:
        "Para vos ya está listo o se está generando; no hay nada que pedir de nuevo.",
    });
    await crearTrabajo({
      prisma: tx,
      tipo: "generar_feedback",
      payload: { sesionId, pacienteId, generacion: existente.generacion },
      organizationId,
      sesionId,
      pacienteId,
    });
  });

  const sesion = await leerSesion(prisma, sesionId, organizationId);

  await registrarAuditoria(prisma, {
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.pedir_feedback",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: { estadoSesion: sesion.estado },
  });

  return sesion;
}
