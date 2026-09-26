// La grabación, del lado del servidor: crear la sesión, firmar la subida del
// archivo y cerrar la sesión recién cuando R2 confirma que el archivo llegó.
//
// Un solo archivo por sesión, tal como lo grabó el teléfono. La app no cifra
// el audio: viaja por TLS, R2 lo cifra en reposo y se borra tras procesarse.
// El servidor no lleva inventario de trozos: lo único que decide el cierre es
// HeadObject sobre la key calculada (`<org>/<sesion>/0`, estados.ts).

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import { consentimientoVigenteDe } from "@/lib/consentimiento";
import { PRUEBA_TOPE } from "@/lib/glosario";
import { TOPE_GRABACIONES_PRUEBA } from "@/lib/limites-prueba";
import { MINIMO_SEGUNDOS } from "@/lib/grabacion-captura";
import {
  CODIGO_GRABACION_CORTA,
  keyAudio,
  prefijoAudio,
} from "@/lib/sesion-clinica/estados";
import type { DiagnosticoGrabacion, PausaGrabacion } from "@/lib/sesion-clinica/schema";

import { DETALLE_MAX_ARRAY } from "../auditoria-pura";

import { ApiError } from "../responses";
import { SESION_SELECT, toSesionClinicaResponse } from "../sesion-clinica";

import { leerSesion } from "./sesion/leer";
import { transicionar } from "./sesion/transicion";
import { crearTrabajo } from "./trabajos/crear";

type Base = { prisma: typeof db; organizationId: string };
type Sesion = Base & { sesionId: string };

/** Lo que la subida necesita de R2. `src/lib/r2.ts` lo implementa; los tests
 *  lo doblan. */
export interface AlmacenAudio {
  firmarSubida: (
    key: string,
    opciones: { contentType: string; contentLength: number; expiraEnSegundos: number },
  ) => Promise<{ url: string; expiraEn: Date }>;
  existe: (key: string) => Promise<{ existe: boolean; bytes: number | null }>;
}

/** Validez de la URL prefirmada: una sesión larga en una conexión mala. */
export const EXPIRA_URL_SUBIDA_SEGUNDOS = 60 * 60;

export const MENSAJE_NO_LLEGO =
  "El audio no llegó a R2. La sesión volvió a 'grabando': reintentá la subida.";

/**
 * Lo que se le contesta a una grabación más corta que el mínimo.
 *
 * El teléfono ya no la sube: `MINIMO_SEGUNDOS` de grabacion-captura.ts corta
 * antes. Pero una PWA vieja cacheada sigue llamando a esta ruta, y el 19 de
 * septiembre una grabación de 2 segundos se subió, se transcribió —con su
 * costo— y terminó fallida con `asr_vacio`. Es la misma constante de los dos
 * lados: ese módulo no importa NADA, así que el servidor lo puede leer sin
 * arrastrar nada del navegador (lo vigila un test).
 */
export const MENSAJE_GRABACION_CORTA = `La grabación es más corta que el mínimo de ${MINIMO_SEGUNDOS} segundos: no se transcribe y el audio se borra.`;

export async function leerSesionPorTurno({ prisma, organizationId, turnoId }: Base & { turnoId: string }) {
  const fila = await prisma.sesionClinica.findFirst({ where: { turnoId, organizationId }, select: SESION_SELECT });
  return fila ? toSesionClinicaResponse(fila) : null;
}

export async function prepararAudio({ prisma, organizationId, turnoId }: Base & { turnoId: string }) {
  return prisma.$transaction(async (tx) => {
    // Serializa dos inicios del mismo turno sin reemplazar su identidad.
    const tocado = await tx.turno.updateMany({ where: { id: turnoId, organizationId, estado: { in: ["programado", "realizado"] } }, data: { actualizadoEn: new Date() } });
    if (!tocado.count) throw new ApiError("El turno no está disponible para grabar", 409);
    const turno = await tx.turno.findUniqueOrThrow({ where: { id: turnoId }, select: { pacienteId: true } });
    if (!await consentimientoVigenteDe(tx, turno.pacienteId, organizationId)) throw new ApiError("Falta consentimiento vigente para grabar", 400);
    const existente = await tx.sesionClinica.findUnique({ where: { turnoId }, select: { id: true, estado: true } });
    if (existente) {
      if (existente.estado !== "grabando") throw new ApiError("La grabación ya se cerró. Revisá su estado.", 409);
      return { id: existente.id };
    }
    // Una grabación nueva suma al contador del consultorio. En un consultorio
    // de prueba, sólo si no llegó al tope: el UPDATE toma el lock de la fila y
    // vuelve a mirar la condición, así dos inicios a la vez no pasan del tope.
    // Reanudar la misma grabación (arriba) no suma.
    const contada = await tx.organization.updateMany({
      where: { id: organizationId, OR: [{ deInvitacion: false }, { grabacionesIniciadas: { lt: TOPE_GRABACIONES_PRUEBA } }] },
      data: { grabacionesIniciadas: { increment: 1 } },
    });
    if (!contada.count) throw new ApiError(PRUEBA_TOPE, 403);
    const id = randomUUID();
    await tx.sesionClinica.create({ data: { id, organizationId, turnoId, estado: "grabando" } });
    return { id };
  });
}

/**
 * Paso 1 de la subida: la sesión pasa grabando → subiendo y devuelve la URL
 * prefirmada del PUT.
 *
 * La URL se firma ANTES de tocar la fila: si R2 falla, la sesión sigue en
 * grabando y el cliente reintenta sin más. La transición lleva el estado en
 * el WHERE, así dos pestañas pidiendo URL a la vez no se pisan.
 */
export async function pedirUrlSubida(input: Sesion & { tamanoBytes: number; mime: string; almacen: AlmacenAudio }) {
  const { prisma, organizationId, sesionId, tamanoBytes, mime, almacen } = input;
  const fila = await prisma.sesionClinica.findFirst({ where: { id: sesionId, organizationId }, select: { estado: true } });
  if (!fila) throw new ApiError("Sesión clínica no encontrada", 404);
  if (fila.estado !== "grabando") {
    throw new ApiError(
      fila.estado === "subiendo"
        ? "La sesión ya tiene una subida en curso. Para reintentar, volvé la sesión a 'grabando' y pedí una URL nueva."
        : `Solo se puede iniciar la subida desde una sesión en estado grabando (estado actual: ${fila.estado})`,
      409,
    );
  }
  const key = keyAudio(organizationId, sesionId, 0);
  const { url, expiraEn } = await almacen.firmarSubida(key, { contentType: mime, contentLength: tamanoBytes, expiraEnSegundos: EXPIRA_URL_SUBIDA_SEGUNDOS });
  await transicionar({
    prisma,
    operacion: "empezar_subida",
    sesionId,
    organizationId,
    data: { falloCodigo: null, falloDetalle: null },
    conflicto: "La sesión cambió mientras se preparaba la subida. Probá de nuevo.",
  });
  // El navegador DEBE mandar exactamente estos headers en el PUT: están firmados en la URL.
  return { url, key, expiraEn, headers: { "Content-Type": mime } };
}

/** Reintento del cliente (POST [id]/volver-a-grabar): subiendo → grabando, para pedir otra URL. */
export async function volverAGrabar({ prisma, organizationId, sesionId }: Sesion) {
  await transicionar({ prisma, operacion: "volver_a_grabar", sesionId, organizationId, conflicto: "Solo una sesión en 'subiendo' puede volver a 'grabando'." });
  return toSesionClinicaResponse(await leerSesion(prisma, sesionId, organizationId));
}

/**
 * Paso 3: el único cierre de la grabación. HeadObject sobre la key calculada;
 * si el objeto no está, la sesión vuelve a grabando y se contesta 409 para
 * que el teléfono repita la subida. Si está, subiendo → procesando.
 */
export async function confirmarSubida(input: Sesion & { key: string; duracionAudioSeg: number; pausas?: PausaGrabacion[]; almacen: AlmacenAudio }) {
  const { prisma, organizationId, sesionId, key, duracionAudioSeg, pausas, almacen } = input;
  const fila = await prisma.sesionClinica.findFirst({ where: { id: sesionId, organizationId }, select: { estado: true } });
  if (!fila) throw new ApiError("Sesión clínica no encontrada", 404);
  if (fila.estado !== "subiendo") throw new ApiError(`Solo se puede confirmar una subida en curso (estado actual: ${fila.estado})`, 409);
  if (key !== keyAudio(organizationId, sesionId, 0)) throw new ApiError("La key no corresponde a esta sesión", 400);

  const { existe, bytes } = await almacen.existe(key);
  if (!existe) {
    try {
      await transicionar({ prisma, operacion: "volver_a_grabar", sesionId, organizationId });
    } catch {
      // count = 0: otra pestaña ya la movió. El 409 de abajo sigue valiendo.
    }
    throw new ApiError(MENSAJE_NO_LLEGO, 409);
  }

  // ── El mínimo, también acá ──────────────────────────────────────────
  // Antes de la transición a `procesando`, que es la que le pone el trabajo
  // en la cola al worker y dispara el gasto del ASR. La sesión queda
  // `fallida` con su código —así aparece en Pendientes y ella puede
  // eliminarla— y el audio que YA está en R2 se encola para borrado en la
  // misma transacción: o quedan las dos escrituras, o ninguna.
  if (duracionAudioSeg < MINIMO_SEGUNDOS) {
    await prisma.$transaction(async (tx) => {
      await transicionar({
        prisma: tx,
        operacion: "abandonar",
        sesionId,
        organizationId,
        data: {
          // `sin_audio` y no `en_r2`: el audio se está borrando (el trabajo
          // de abajo), y `en_r2` la dejaría reintentable (HAY_MATERIAL)
          // contra un archivo que va a desaparecer. Pendientes ofrece sólo
          // eliminarla. El trabajo la deja en `borrado` cuando termina.
          audioEstado: "sin_audio",
          duracionAudioSeg,
          falloCodigo: CODIGO_GRABACION_CORTA,
          proximoIntentoEn: null,
        },
        conflicto: "La sesión cambió de estado durante la confirmación",
      });
      await crearTrabajo({
        prisma: tx,
        tipo: "borrar_audio_r2",
        payload: { prefijo: prefijoAudio(organizationId, sesionId), indices: [0] },
        organizationId,
        sesionId,
      });
    });
    throw new ApiError(MENSAJE_GRABACION_CORTA, 422, CODIGO_GRABACION_CORTA);
  }

  await transicionar({
    prisma,
    operacion: "audio_listo",
    sesionId,
    organizationId,
    data: {
      audioEstado: "en_r2",
      duracionAudioSeg,
      ...(pausas ? { pausas: pausas as unknown as Prisma.InputJsonArray } : {}),
      proximoIntentoEn: new Date(),
    },
    conflicto: "La sesión cambió de estado durante la confirmación",
  });
  return { bytes, sesion: toSesionClinicaResponse(await leerSesion(prisma, sesionId, organizationId)) };
}

/**
 * El diagnóstico del grabador, en la forma que la auditoría acepta.
 *
 * `detalleSeguro` (auditoria-pura.ts) sólo deja pasar primitivos y arrays
 * cortos de primitivos, y descarta en silencio cualquier objeto anidado: es su
 * garantía de que al rastro no entra texto clínico. El diagnóstico llegaba como
 * objeto y por eso se perdió entero en las primeras grabaciones reales (19/9).
 *
 * Acá se aplana: los conteos como números y cada evento como un string
 * "hora tipo [ms]", en tandas de DETALLE_MAX_ARRAY bajo `diagnostico`,
 * `diagnostico2`, `diagnostico3`… Todo lo que entra ya pasó por el schema Zod:
 * horas ISO, tipos de una lista cerrada y enteros. No hay texto libre.
 */
export function diagnosticoParaAuditoria(diagnostico: DiagnosticoGrabacion): Record<string, number | string[]> {
  const eventos = diagnostico.eventos.map((e) => `${e.t} ${e.tipo}${e.ms === undefined ? "" : ` ${e.ms}`}`);
  const detalle: Record<string, number | string[]> = {
    diagnosticoChunks: diagnostico.chunks,
    diagnosticoBytes: diagnostico.bytes,
    diagnosticoEventos: eventos.length,
    diagnostico: eventos.slice(0, DETALLE_MAX_ARRAY),
  };
  for (let desde = DETALLE_MAX_ARRAY, tanda = 2; desde < eventos.length; desde += DETALLE_MAX_ARRAY, tanda += 1) {
    detalle[`diagnostico${tanda}`] = eventos.slice(desde, desde + DETALLE_MAX_ARRAY);
  }
  return detalle;
}
