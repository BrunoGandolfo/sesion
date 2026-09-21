// "Volver a escribirla": revision → procesando, sin borrar nada.
//
// La generación anterior (nota IA, datos, feedback) queda hasta que el
// resultado siguiente la reemplace; la transcripción se conserva y el worker
// la recibe como checkpoint, así que no se vuelve a pagar el ASR. Exige que
// haya transcripción o audio: sin ninguno de los dos no habría nada que
// procesar y la sesión quedaría colgada en `procesando`.

import { registrarAuditoria } from "../../auditoria";
import type { FilaSesionClinica } from "../../sesion-clinica";

import { leerSesion } from "./leer";
import { transicionar, type ClienteTransaccional } from "./transicion";

export interface ReprocesarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  ahora?: Date;
}

/** Condición común a reprocesar y reintentar: hay con qué procesar. */
export const HAY_MATERIAL = {
  OR: [{ audioEstado: "en_r2" as const }, { modeloAsr: { not: null } }],
};

/**
 * La MISMA condición, para decidirlo sobre una fila ya leída (Pendientes usa
 * esto para decir si una sesión fallida se puede reintentar).
 *
 * Son dos escrituras de una sola regla: una viaja al WHERE y la otra corre en
 * memoria, y no hay forma de derivar una de la otra sin un intérprete de
 * `where`. Lo que las ata es un test —rutas-area2 / feedback-trabajos— que
 * corre las dos sobre las mismas filas y exige la misma respuesta. Si cambia
 * una, cambian las dos, o el test se pone rojo.
 */
export function hayMaterial(sesion: {
  audioEstado: string;
  modeloAsr: string | null;
}): boolean {
  return sesion.audioEstado === "en_r2" || sesion.modeloAsr !== null;
}

/** Lo que las dos vueltas a `procesando` escriben, además del estado. */
export function datosVueltaAProcesando(ahora: Date) {
  return {
    fallosSeguidos: 0,
    proximoIntentoEn: ahora,
    leaseVenceEn: null,
    ticketHash: null,
    falloCodigo: null,
    falloDetalle: null,
  };
}

export async function reprocesarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  ahora = new Date(),
}: ReprocesarSesionInput): Promise<FilaSesionClinica> {
  await transicionar({
    prisma,
    operacion: "reprocesar",
    sesionId,
    organizationId,
    condiciones: HAY_MATERIAL,
    data: datosVueltaAProcesando(ahora),
    conflicto:
      "La sesión no está en revisión, o no tiene audio ni transcripción para volver a escribir la nota.",
  });

  const sesion = await leerSesion(prisma, sesionId, organizationId);

  await registrarAuditoria(prisma, {
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.reprocesar",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: { desde: "revision", hacia: "procesando", generacion: sesion.generacion },
  });

  return sesion;
}
