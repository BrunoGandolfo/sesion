// Abrir una nota: la lectura y su rastro (sesion.ver) en UNA transacción.
//
// El consentimiento que firma la paciente promete que "cada vez que abre tu
// nota o tu transcripción queda registrado" (consentimiento-hechos.ts,
// ACCION_VER_SESION). Antes la ruta leía y después auditaba con la variante
// informativa: si el INSERT fallaba, la nota salía igual y la promesa no se
// cumplía. Decisión del dueño (D2): estricto. Sin rastro no hay nota; la
// ruta contesta 500 como cualquier error interno, igual que el historial
// clínico (documentacion.ts).
//
// Los avisos de notas (avisos-notas.ts) leen estos mismos eventos para saber
// qué vio cada usuaria: el detalle lleva el estado en que la vio.

import { ACCIONES } from "@/lib/auditoria-acciones";

import { auditar } from "../../auditoria";
import { toSesionClinicaResponse } from "../../sesion-clinica";

import { leerSesion } from "./leer";
import type { ClienteTransaccional } from "./transicion";

export interface VerSesionInput {
  prisma: ClienteTransaccional;
  organizationId: string;
  sesionId: string;
  usuarioId: string;
}

export async function verSesion({ prisma, organizationId, sesionId, usuarioId }: VerSesionInput) {
  return prisma.$transaction(async (tx) => {
    const sesion = await leerSesion(tx, sesionId, organizationId);
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.sesion.ver,
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: { estado: sesion.estado },
    });
    return toSesionClinicaResponse(sesion);
  });
}
