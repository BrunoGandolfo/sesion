// Caso de uso: reintentar el procesamiento de una sesión en error
// (transición error → procesando pedida por el cliente vía PATCH).
//
// El worker (processor/) levanta las sesiones en "procesando" vía
// /pendientes, así que la transición re-encola sola. Sin audio en R2 no hay
// nada que procesar y la sesión quedaría colgada en "procesando" para
// siempre: por eso se exige audio. Se limpia el error anterior y se resetea
// `intentos` (lease y tope de /pendientes); sin el reset, una sesión que
// agotó los reintentos volvería a "error" en el primer poll.

import type { db } from "@/lib/db";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { MENSAJE_ELIMINACION_EN_CURSO } from "./eliminar-sesion";
import { ApiError } from "../responses";
import {
  assertTransicionValida,
  SESION_SELECT,
  type FilaSesionClinica,
} from "../sesion-clinica";

type ClientePrisma = typeof db;

export interface ReintentarSesionInput {
  prisma: ClientePrisma;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  /** Valores opcionales que el PATCH puede traer junto con el reintento. */
  audioR2Key?: string;
  duracionAudioSeg?: number;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

/** Devuelve la fila actualizada (con SESION_SELECT), lista para la respuesta. */
export async function reintentarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  audioR2Key,
  duracionAudioSeg,
  registrarAuditoria,
}: ReintentarSesionInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: { id: true, estado: true, audioR2Key: true, error: true },
  });

  if (!existente) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  assertTransicionValida(existente.estado, "procesando");

  if (!audioR2Key && !existente.audioR2Key) {
    throw new ApiError(
      "No hay audio subido para reintentar el procesamiento. Descartá la sesión y volvé a grabar.",
      409,
    );
  }

  // La otra mitad de la reserva del borrado definitivo (ver
  // MENSAJE_ELIMINACION_EN_CURSO en eliminar-sesion.ts): mientras esa marca
  // esté puesta, el audio se está borrando en R2 y re-encolar la sesión
  // dejaría al worker con una sesión sin blob. Es un token, no un lock, justo
  // porque sobrevive al autocommit de quien lo escribió.
  if (existente.error === MENSAJE_ELIMINACION_EN_CURSO) {
    throw new ApiError(
      "Esta sesión se está eliminando: no se puede reintentar.",
      409,
    );
  }

  // La organización va en el WHERE de la ESCRITURA, no sólo en el findFirst
  // de arriba: `update({ where: { id } })` escribe la fila aunque sea de otra
  // organización, y entre la lectura y la escritura hay una ventana. Con
  // updateMany la pertenencia es parte de la operación.
  //
  // Y el ESTADO y el ERROR también, por esa misma ventana: sin ellos, este
  // reintento pisa una eliminación que empezó en el medio y el worker recibe
  // una sesión cuyo audio se está borrando. Con los dos en el WHERE, el
  // UPDATE condicionado toma el lock de la fila y reevalúa el predicado: o
  // gana el reintento, o no escribe nada.
  //
  // Se compara contra el VALOR LEÍDO y no con `NOT: { error: token }`, que
  // fue el primer intento y estaba mal (Codex P2): Prisma lo traduce a
  // `NOT (error = token)`, que en SQL es NULL —no true— cuando la columna es
  // NULL. Una sesión en "error" con `error` nulo, que es un estado alcanzable
  // (procesarCallback puede guardar un error sin texto), no matcheaba nunca:
  // conservaba su audio y aun así el reintento contestaba 409 para siempre.
  //
  // Comparar contra lo leído arregla eso y además es más fuerte: excluye el
  // token —si estuviera puesto, la guarda de más arriba ya habría cortado— y
  // también cualquier otra escritura concurrente sobre la fila.
  const { count } = await prisma.sesionClinica.updateMany({
    where: {
      id: sesionId,
      organizationId,
      estado: existente.estado,
      error: existente.error,
    },
    data: {
      estado: "procesando",
      duracionAudioSeg,
      audioR2Key,
      error: null,
      intentos: 0,
    },
  });

  if (count === 0) {
    // Con el estado y el token en el WHERE, 0 ya no significa sólo "no
    // existe": también "cambió mientras se procesaba el pedido".
    throw new ApiError(
      "La sesión cambió mientras se procesaba el pedido. Volvé a abrirla.",
      409,
    );
  }

  const sesion = await prisma.sesionClinica.findFirstOrThrow({
    where: { id: sesionId, organizationId },
    select: SESION_SELECT,
  });

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.cambiar_estado",
    entidad: "sesion_clinica",
    entidadId: sesion.id,
    detalle: { desde: existente.estado, hacia: "procesando" },
  });

  return sesion;
}
