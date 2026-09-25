// Abandonar una grabación sin terminar: la sesión quedó en `grabando` o
// `subiendo` (el teléfono murió, se cerró el navegador, se cortó la subida)
// y nadie la va a terminar. La descarta la usuaria desde Pendientes, o el
// mantenimiento pasados UMBRAL_HUERFANA_HORAS (siete días).
//
// ─── CON AUDIO O SIN AUDIO LO DICE R2, NO LA FILA ──────────────────────────
//
// En `grabando`/`subiendo` la fila nunca dice `en_r2`: eso lo escribe
// confirmarSubida en la misma transición que la saca de `subiendo`. Pero el
// archivo pudo haber llegado entero y la confirmación no (se cortó justo
// después del PUT). Por eso se pregunta a R2 (HeadObject) ANTES de abrir la
// transacción —es red, no va adentro—, y recién después de verificar que la
// sesión es de esta organización: a una sesión ajena no se le consulta nada.
//
//   - con audio → `abandonar`: queda `fallida` con CODIGO_GRABACION_ABANDONADA
//     y el trabajo `borrar_audio_r2` inmediato. `audioEstado` NO pasa a
//     `en_r2`: el audio se está borrando, y `en_r2` la haría reintentable
//     (HAY_MATERIAL) contra un archivo que va a desaparecer. El trabajo la
//     deja en `borrado` cuando termina.
//   - sin audio → `abandonar_sin_audio`: la fila se borra (como eliminar) y el
//     turno queda libre para grabar de nuevo. Igual se anota un
//     `borrar_audio_r2`, DIFERIDO: una URL de subida firmada vale una hora
//     (EXPIRA_URL_SUBIDA_SEGUNDOS) y un PUT lento todavía en vuelo dejaría un
//     audio clínico en R2 sin ninguna fila que lo nombre. Borrar una key que
//     no existe no cuesta nada; el trabajo lo confirma con HeadObject.
//
// Todo lo de la base —la transición o el DELETE, el trabajo y el evento de
// auditoría— va en UNA transacción: si el rastro no se puede escribir, no
// pasa nada (auditoria.ts). La escritura lleva el estado de partida en el
// WHERE; si la subida se confirmó entre la consulta a R2 y el COMMIT, count
// = 0 y se contesta 409 sin tocar nada.

import {
  CODIGO_GRABACION_ABANDONADA,
  ESTADOS_SIN_TERMINAR,
  keyAudio,
  prefijoAudio,
} from "@/lib/sesion-clinica/estados";

import { auditar } from "../../auditoria";
import { ApiError } from "../../responses";
import type { AlmacenAudio } from "../audio";
import { EXPIRA_URL_SUBIDA_SEGUNDOS } from "../audio";
import { crearTrabajo } from "../trabajos/crear";

import {
  MENSAJE_CONFLICTO,
  MENSAJE_NO_ENCONTRADA,
  transicionar,
  whereTransicion,
  type ClienteTransaccional,
} from "./transicion";

export const ACCION_ABANDONAR = "sesion.abandonar";

export const MENSAJE_NO_SIN_TERMINAR =
  "Solo se puede descartar una grabación sin terminar.";

/** Cuánto se espera para el borrado de seguridad de una sesión sin audio:
 *  el doble de lo que vale la URL de subida. */
export const ESPERA_BORRADO_SIN_AUDIO_MS = 2 * EXPIRA_URL_SUBIDA_SEGUNDOS * 1000;

export type ActorAbandono =
  | { tipo: "usuario"; id: string }
  | { tipo: "sistema" };

export interface AbandonarSesionInput {
  prisma: ClienteTransaccional;
  almacen: Pick<AlmacenAudio, "existe">;
  sesionId: string;
  organizationId: string;
  actor: ActorAbandono;
  ahora?: Date;
}

export interface SesionAbandonada {
  /** `fallida` si había audio (queda en Pendientes para eliminarla);
   *  `borrada` si no había nada que conservar. */
  resultado: "fallida" | "borrada";
  conAudio: boolean;
}

export async function abandonarSesion({
  prisma,
  almacen,
  sesionId,
  organizationId,
  actor,
  ahora = new Date(),
}: AbandonarSesionInput): Promise<SesionAbandonada> {
  const fila = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: { estado: true, turno: { select: { pacienteId: true } } },
  });
  if (!fila) throw new ApiError(MENSAJE_NO_ENCONTRADA, 404);
  if (!ESTADOS_SIN_TERMINAR.includes(fila.estado)) {
    throw new ApiError(MENSAJE_NO_SIN_TERMINAR, 409);
  }

  const { existe: conAudio } = await almacen.existe(keyAudio(organizationId, sesionId, 0));
  const payload = { prefijo: prefijoAudio(organizationId, sesionId), indices: [0] };
  const pacienteId = fila.turno.pacienteId;

  return prisma.$transaction(async (tx) => {
    if (conAudio) {
      await transicionar({
        prisma: tx,
        operacion: "abandonar",
        sesionId,
        organizationId,
        data: {
          falloCodigo: CODIGO_GRABACION_ABANDONADA,
          falloDetalle: null,
          proximoIntentoEn: null,
        },
      });
      await crearTrabajo({
        prisma: tx,
        tipo: "borrar_audio_r2",
        payload,
        organizationId,
        sesionId,
        pacienteId,
      });
    } else {
      const { count } = await tx.sesionClinica.deleteMany({
        where: whereTransicion({ operacion: "abandonar_sin_audio", sesionId, organizationId }),
      });
      if (count === 0) throw new ApiError(MENSAJE_CONFLICTO, 409);
      await crearTrabajo({
        prisma: tx,
        tipo: "borrar_audio_r2",
        payload,
        organizationId,
        sesionId,
        pacienteId,
        proximoIntentoEn: new Date(ahora.getTime() + ESPERA_BORRADO_SIN_AUDIO_MS),
      });
    }

    const resultado = conAudio ? "fallida" : "borrada";
    await auditar(tx, {
      organizationId,
      actorTipo: actor.tipo,
      actorId: actor.tipo === "usuario" ? actor.id : null,
      accion: ACCION_ABANDONAR,
      entidad: "sesion_clinica",
      entidadId: sesionId,
      creadoEn: ahora,
      detalle: { desde: fila.estado, hacia: resultado, conAudio },
    });

    return { resultado, conAudio };
  });
}
