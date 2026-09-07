// Caso de uso: DELETE de una sesión clínica. Tres ramas con nombre, según
// el estado en que está la sesión:
//   - descartarNotaEnRevision: revision → error, conservando transcripción,
//     audio y la clave temporal (la sesión queda reprocesable).
//   - eliminarSesionConError: borrado definitivo, solo si el audio en R2 se
//     pudo borrar (o no había).
//   - resolverGrabacionAbandonada: huérfana en "grabando"; con audio pasa a
//     error, sin audio se elimina.
// Cualquier otro estado → ApiError 409.
//
// ─── LA INTENCIÓN LA TRAE QUIEN LLAMA ───────────────────────────────────────
//
// Hasta acá el estado de la fila era lo ÚNICO que decidía qué pasaba, y las
// dos acciones de la pantalla de la nota —"Descartar" y "Eliminar"— mandaban
// exactamente el mismo request. Los dos textos prometen cosas opuestas:
//
//   Descartar → "Se puede deshacer: la sesión vuelve a error y la podés
//                volver a escribir. La transcripción y el audio se conservan."
//   Eliminar  → "Se borran la sesión y su audio. No queda registro y no se
//                puede deshacer."
//
// Con la intención implícita, entre que la pantalla se dibujó y la usuaria
// tocó el botón la fila puede haber cambiado de estado —el worker contestó,
// otra pestaña descartó— y entonces se confirma una cosa y ocurre la otra.
// El caso feo es concreto: leer "se puede deshacer", tocar, y que la sesión
// se borre para siempre porque mientras tanto había pasado a "error".
//
// Ahora la intención viaja explícita y el caso de uso la contrasta con el
// estado real. Si no coinciden, 409 y no se toca nada: quien pidió descartar
// nunca elimina, y quien pidió eliminar nunca descarta.
//
// La comprobación vive acá y no en la ruta a propósito: el estado se lee una
// sola vez, y validar en la ruta obligaría a leerlo dos veces con una ventana
// en el medio, que es justamente lo que se está cerrando.

import type { db } from "@/lib/db";
import { cifrarSesion } from "@/lib/prisma-encryption";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { ApiError } from "../responses";
import { assertTransicionValida, extraerClaveTemporal } from "../sesion-clinica";

type ClientePrisma = typeof db;

/**
 * Qué pidió quien llama, con las mismas palabras que la pantalla:
 *
 *   "descartar" — tirar lo generado y conservar lo grabado. Vale sobre una
 *     nota en revisión y sobre una grabación abandonada. (Si esa grabación no
 *     llegó a subir audio no queda nada que conservar y la fila se elimina:
 *     el resultado es un borrado, la intención sigue siendo descartar.)
 *
 *   "eliminar" — borrado definitivo, con el audio. Solo sobre una sesión en
 *     error, que es el único estado desde el que la pantalla lo ofrece.
 */
export const ACCIONES_ELIMINAR = ["descartar", "eliminar"] as const;
export type AccionEliminar = (typeof ACCIONES_ELIMINAR)[number];

export interface EliminarSesionInput {
  prisma: ClientePrisma;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  /** Qué pidió la usuaria. Se contrasta con el estado real de la fila. */
  accion: AccionEliminar;
  /** Borrado best-effort del audio en R2: true si ya no queda audio. */
  borrarAudio: (audioR2Key: string | null) => Promise<boolean>;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
}

export type ResultadoEliminarSesion =
  | { tipo: "nota_descartada"; audioConservado: boolean }
  | { tipo: "grabacion_abandonada_a_error" }
  | { tipo: "eliminada" };

export const MENSAJE_AUDIO_NO_BORRADO =
  "No se pudo borrar el audio en R2; la sesión se conserva para reintentar la eliminación";

/**
 * Token de la reserva del borrado definitivo. Se escribe en `error` antes de
 * tocar R2 y es lo que impide que un reintento concurrente re-encole la
 * sesión mientras el audio se está borrando: `reintentarSesion` lo rechaza.
 *
 * Si aparece en una fila viva, la eliminación se cortó entre el borrado del
 * blob y el DELETE: el audio puede no estar aunque la sesión sí.
 */
export const MENSAJE_ELIMINACION_EN_CURSO =
  "Eliminación en curso: se está borrando el audio antes de eliminar la sesión";

type SesionExistente = {
  id: string;
  estado: string;
  audioR2Key: string | null;
  datosEstructurados: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type Contexto = Omit<EliminarSesionInput, "sesionId"> & {
  existente: SesionExistente;
};

function tieneAudioReal(audioR2Key: string | null): boolean {
  return Boolean(audioR2Key && audioR2Key !== "dev-no-r2");
}

/**
 * El WHERE de toda escritura de esta sesión: id, organización Y el estado que
 * se leyó.
 *
 * La organización, porque `update({ where: { id } })` escribe la fila aunque
 * sea de otra; el findFirst comprueba la pertenencia, pero entre esa lectura
 * y la escritura hay una ventana.
 *
 * El ESTADO, porque esa misma ventana la puede usar otra pestaña. El caso
 * concreto, y es destructivo: se lee la sesión en "error", y antes de que
 * este DELETE escriba, un `PATCH { estado: "procesando" }` la re-encola al
 * worker (reintentarSesion escribe con `{ id, organizationId }`, sin mirar
 * el estado, así que gana). Sin el estado en el where, el `deleteMany`
 * borraría una sesión que está procesándose, con su audio. Con el estado, un
 * UPDATE/DELETE condicionado toma el lock de la fila y vuelve a evaluar el
 * predicado: o gana este DELETE, o no toca nada y contesta 409.
 *
 * Por eso ahora el `count` SÍ se mira en cada rama (Codex P1 sobre este PR):
 * 0 dejó de ser imposible y pasó a ser exactamente el caso que hay que
 * rechazar.
 */
function suya(ctx: Contexto): {
  id: string;
  organizationId: string;
  estado: string;
} {
  return {
    id: ctx.existente.id,
    organizationId: ctx.organizationId,
    estado: ctx.existente.estado,
  };
}

/** La sesión cambió de estado entre la lectura y la escritura. */
function cambioEnElMedio(estadoLeido: string): ApiError {
  return new ApiError(
    `La sesión cambió mientras se procesaba el pedido (estaba en ${estadoLeido}). Volvé a abrirla.`,
    409,
  );
}

function auditar(
  ctx: Contexto,
  accion: "sesion.descartar" | "sesion.eliminar",
  audioConservado: boolean,
): Promise<void> {
  return ctx.registrarAuditoria({
    organizationId: ctx.organizationId,
    actorTipo: "usuario",
    actorId: ctx.usuarioId,
    accion,
    entidad: "sesion_clinica",
    entidadId: ctx.existente.id,
    detalle: { estadoPrevio: ctx.existente.estado, audioConservado },
  });
}

// Nota en revisión: descartar ≠ destruir. Se limpia SOLO lo generado por el
// LLM (nota SOAP + datos estructurados); la transcripción y el audio NO se
// tocan acá. La fila queda en "error", el único estado reprocesable
// (error → procesando vía PATCH re-encola al worker).
async function descartarNotaEnRevision(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente } = ctx;
  assertTransicionValida(existente.estado, "error");
  const audioConservado = tieneAudioReal(existente.audioR2Key);
  // Se limpia todo lo generado (las 4 secciones en null dejan la nota SOAP
  // en NULL), pero el stash de la clave temporal se preserva: es lo único
  // necesario para reprocesar.
  const claveTemporal = extraerClaveTemporal(existente.datosEstructurados);
  const { count } = await prisma.sesionClinica.updateMany({
    where: suya(ctx),
    data: {
      estado: "error",
      error: audioConservado
        ? "Nota descartada por la usuaria. La transcripción y el audio se conservan: podés reprocesar o eliminar definitivamente."
        : "Nota descartada por la usuaria. La transcripción se conserva; no hay audio para reprocesar.",
      ...cifrarSesion({
        notaSubjetivo: null,
        notaObjetivo: null,
        notaAnalisis: null,
        notaPlan: null,
        datosEstructurados: claveTemporal
          ? JSON.stringify({ _audioCifradoTemporal: claveTemporal })
          : null,
      }),
    },
  });

  if (count === 0) {
    throw cambioEnElMedio(existente.estado);
  }

  await auditar(ctx, "sesion.descartar", audioConservado);

  return { tipo: "nota_descartada", audioConservado };
}

// Sesión en error: descarte definitivo. Ningún otro modelo referencia
// SesionClinica (es el lado dependiente de la 1:1 con Turno), así que el
// delete es seguro y libera el turno para volver a grabar. Si el audio real
// no se pudo borrar de R2, la fila NO se elimina: audioR2Key es el único
// puntero al blob y perderlo lo dejaría huérfano e imborrable.
async function eliminarSesionConError(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente, borrarAudio } = ctx;

  // ─── UN TOKEN, NO UN LOCK ────────────────────────────────────────────────
  //
  // Dos intentos previos y por qué no alcanzaban (Codex P1, dos pasadas):
  //
  //   1. Condicionar sólo el DELETE final al estado. El audio se borra ANTES,
  //      así que el reintento gana la carrera, el DELETE devuelve 0 y queda
  //      una sesión "procesando" cuyo blob ya no existe.
  //
  //   2. Agregar una reserva (updateMany condicionado) antes del borrado. Un
  //      updateMany suelto autocommitea: suelta el lock de la fila antes del
  //      `await borrarAudio` y deja la fila en "error", que es exactamente lo
  //      que el reintento necesita para pasar. Misma ventana.
  //
  // Y meter todo en una transacción para sostener el lock tampoco sirve, por
  // dos motivos que se ven al escribir el test: cualquier escritor concurrente
  // de esa fila queda bloqueado toda la llamada de red, y si la transacción
  // expira se revierte la base pero NO el borrado en R2 — el efecto que hay
  // que proteger es justamente el que no participa de la transacción.
  //
  // Lo que sí cierra la ventana es un token: la reserva escribe una marca en
  // `error`, y `reintentarSesion` se niega a re-encolar una sesión que la
  // tiene (ver reintentar-sesion.ts, que además condiciona su propia
  // escritura). El token sobrevive al autocommit, que es lo que un lock no
  // hace, y no bloquea a nadie.
  //
  // Si el proceso se muere entre el borrado del blob y el DELETE, la fila
  // queda con el token: dice lo que pasó, el reintento la rechaza —así que el
  // worker nunca recibe una sesión sin audio— y lo único que se puede hacer
  // con ella, eliminarla, es lo que se estaba pidiendo.
  const reserva = await prisma.sesionClinica.updateMany({
    where: suya(ctx),
    data: { error: MENSAJE_ELIMINACION_EN_CURSO },
  });

  if (reserva.count === 0) {
    throw cambioEnElMedio(existente.estado);
  }

  const audioBorrado = await borrarAudio(existente.audioR2Key);

  if (!audioBorrado && tieneAudioReal(existente.audioR2Key)) {
    // El token se reemplaza por el motivo real: el audio sigue estando, así
    // que la sesión vuelve a ser reintentable y eliminable.
    await prisma.sesionClinica.updateMany({
      where: { ...suya(ctx), error: MENSAJE_ELIMINACION_EN_CURSO },
      data: { error: MENSAJE_AUDIO_NO_BORRADO },
    });
    throw new ApiError(MENSAJE_AUDIO_NO_BORRADO, 409);
  }

  // El token va en el WHERE junto con el estado: sólo borra quien reservó.
  const borrada = await prisma.sesionClinica.deleteMany({
    where: { ...suya(ctx), error: MENSAJE_ELIMINACION_EN_CURSO },
  });

  if (borrada.count === 0) {
    throw cambioEnElMedio(existente.estado);
  }

  await auditar(ctx, "sesion.eliminar", false);

  return { tipo: "eliminada" };
}

// Grabación abandonada (huérfana en "grabando"): el umbral se valida
// server-side para no permitir descartar una grabación activa. Con audio
// subido se conserva fila y audio (a error: desde ahí se puede reintentar o
// descartar definitivamente); sin audio no hay nada que conservar y la
// eliminación libera el turno.
async function resolverGrabacionAbandonada(
  ctx: Contexto,
): Promise<ResultadoEliminarSesion> {
  const { prisma, existente } = ctx;
  if (existente.audioR2Key) {
    assertTransicionValida(existente.estado, "error");
    const { count } = await prisma.sesionClinica.updateMany({
      where: suya(ctx),
      data: {
        estado: "error",
        error: "Grabación abandonada — descartada por la usuaria",
      },
    });

    if (count === 0) {
      throw cambioEnElMedio(existente.estado);
    }

    await auditar(ctx, "sesion.descartar", true);

    return { tipo: "grabacion_abandonada_a_error" };
  }

  // Sin audio no hay nada que conservar. El estado sigue en el WHERE: una
  // grabación que se dio por abandonada pero que en el medio subió el audio
  // (grabando → subiendo) no se borra por debajo.
  const { count } = await prisma.sesionClinica.deleteMany({
    where: suya(ctx),
  });

  if (count === 0) {
    throw cambioEnElMedio(existente.estado);
  }

  await auditar(ctx, "sesion.eliminar", false);

  return { tipo: "eliminada" };
}

/**
 * El desacuerdo entre lo que se pidió y lo que la fila permite, dicho de
 * manera que la pantalla lo pueda mostrar tal cual: qué pasó, y qué se puede
 * hacer ahora. No dice "409": dice que la sesión cambió.
 */
function conflictoDeIntencion(
  accion: AccionEliminar,
  estado: string,
): ApiError {
  if (accion === "descartar") {
    return new ApiError(
      estado === "error"
        ? "Esta nota ya está descartada: la sesión quedó en error. Podés volver a escribirla o eliminarla definitivamente."
        : `La sesión cambió mientras mirabas la pantalla y ya no tiene una nota para descartar (estado actual: ${estado}). Volvé a abrirla.`,
      409,
    );
  }

  return new ApiError(
    estado === "revision"
      ? "Esta sesión tiene una nota esperando revisión: no se elimina sin descartarla antes. Volvé a abrirla."
      : `La sesión cambió mientras mirabas la pantalla y todavía no se puede eliminar (estado actual: ${estado}). Volvé a abrirla.`,
    409,
  );
}

export async function eliminarSesion(
  input: EliminarSesionInput,
): Promise<ResultadoEliminarSesion> {
  const { prisma, sesionId, organizationId, accion } = input;

  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: {
      id: true,
      estado: true,
      audioR2Key: true,
      datosEstructurados: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existente) {
    throw new ApiError("Sesión clínica no encontrada", 404);
  }

  const ctx: Contexto = { ...input, existente };

  // Cada rama exige SU intención. El orden es el de antes (el estado sigue
  // eligiendo la rama); lo nuevo es que una intención que no le corresponde
  // no cae a la rama siguiente, corta acá.
  if (existente.estado === "revision") {
    if (accion !== "descartar") {
      throw conflictoDeIntencion(accion, existente.estado);
    }
    return descartarNotaEnRevision(ctx);
  }

  if (existente.estado === "error") {
    if (accion !== "eliminar") {
      throw conflictoDeIntencion(accion, existente.estado);
    }
    return eliminarSesionConError(ctx);
  }

  if (existente.estado === "grabando" && esSesionHuerfana(existente)) {
    if (accion !== "descartar") {
      throw conflictoDeIntencion(accion, existente.estado);
    }
    return resolverGrabacionAbandonada(ctx);
  }

  throw new ApiError(
    `Solo se puede descartar una nota en revisión, una sesión con error o una grabación abandonada (estado actual: ${existente.estado})`,
    409,
  );
}
