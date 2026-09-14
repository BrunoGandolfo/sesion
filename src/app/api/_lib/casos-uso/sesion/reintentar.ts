// Reintentar: fallida → procesando. Mismo cuerpo que reprocesar más limpiar
// el fallo. `intento` NO se resetea (es identidad); lo que vuelve a cero es
// `fallosSeguidos`. Sin tope a propósito: es una acción humana.

import type { EventoAuditoriaInput } from "../../auditoria-pura";
import type { FilaSesionClinica } from "../../sesion-clinica";

import { leerSesion } from "./leer";
import { datosVueltaAProcesando, HAY_MATERIAL } from "./reprocesar";
import { transicionar, type ClienteTransaccional } from "./transicion";

export interface ReintentarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
  ahora?: Date;
}

export async function reintentarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  registrarAuditoria,
  ahora = new Date(),
}: ReintentarSesionInput): Promise<FilaSesionClinica> {
  await transicionar({
    prisma,
    operacion: "reintentar",
    sesionId,
    organizationId,
    condiciones: HAY_MATERIAL,
    data: datosVueltaAProcesando(ahora),
    conflicto:
      "La sesión no está fallida, o no tiene audio ni transcripción para reintentar.",
  });

  const sesion = await leerSesion(prisma, sesionId, organizationId);

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.reintentar",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: { desde: "fallida", hacia: "procesando", intento: sesion.intento },
  });

  return sesion;
}
