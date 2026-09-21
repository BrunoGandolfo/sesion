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
