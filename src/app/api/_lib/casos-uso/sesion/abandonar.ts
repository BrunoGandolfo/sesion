// Cerrar una grabación sin terminar: la sesión quedó en `grabando` o
// `subiendo` (el teléfono murió, se cerró el navegador, se cortó la subida)
// y nadie la va a terminar. Dos entradas, una regla:
//
//   LO QUE ELLA DESCARTA A MANO DESAPARECE; LO QUE EL SISTEMA ABANDONA SOLO
//   QUEDA VISIBLE COMO FALLIDA.
//
//   - descartarSesion (la usuaria, "Descartar" en Pendientes): la fila se
//     borra SIEMPRE (`abandonar_y_borrar`) y el turno queda libre para grabar
//     de nuevo. Ella ya dijo que no la quiere: dejarle una fallida para
//     "Eliminar" después era pedirle dos veces lo mismo.
//   - abandonarSesion (el mantenimiento, pasados UMBRAL_HUERFANA_HORAS): con
//     audio queda `fallida` con CODIGO_GRABACION_ABANDONADA (`abandonar`),
//     para que ella se entere de que se perdió una sesión grabada; sin audio
//     no hay nada que mostrar y la fila se borra.
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
//   - con audio → `borrar_audio_r2` inmediato. Si la fila queda (`fallida`),
//     `audioEstado` NO pasa a `en_r2`: el audio se está borrando, y `en_r2`
//     la haría reintentable (HAY_MATERIAL) contra un archivo que va a
//     desaparecer. El trabajo la deja en `borrado` cuando termina.
//   - sin audio → igual se anota un `borrar_audio_r2`, DIFERIDO: una URL de
//     subida firmada vale una hora (EXPIRA_URL_SUBIDA_SEGUNDOS) y un PUT lento
//     todavía en vuelo dejaría un audio clínico en R2 sin ninguna fila que lo
//     nombre. Borrar una key que no existe no cuesta nada; el trabajo lo
//     confirma con HeadObject.
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
import type { ActorAuditoria } from "../../auditoria-pura";
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

/** Ella la descartó desde Pendientes. */
export const ACCION_DESCARTAR = "sesion.descartar_grabacion";
/** El mantenimiento la abandonó pasados los siete días. */
export const ACCION_ABANDONAR = "sesion.abandonar";

export const MENSAJE_NO_SIN_TERMINAR =
  "Solo se puede descartar una grabación sin terminar.";

/** Cuánto se espera para el borrado de seguridad de una sesión sin audio:
 *  el doble de lo que vale la URL de subida. */
export const ESPERA_BORRADO_SIN_AUDIO_MS = 2 * EXPIRA_URL_SUBIDA_SEGUNDOS * 1000;

interface CerrarSinTerminarBase {
  prisma: ClienteTransaccional;
  almacen: Pick<AlmacenAudio, "existe">;
  sesionId: string;
  organizationId: string;
  ahora?: Date;
}

export interface SesionCerrada {
  /** `fallida` sólo si la abandonó el sistema y había audio. */
  resultado: "fallida" | "borrada";
  conAudio: boolean;
}

async function cerrarSinTerminar({
  prisma,
  almacen,
  sesionId,
  organizationId,
  ahora = new Date(),
  conservarConAudio,
  actor,
  accion,
}: CerrarSinTerminarBase & {
  /** Con audio, la fila queda `fallida` en vez de borrarse. */
  conservarConAudio: boolean;
  actor: { tipo: ActorAuditoria; id: string | null };
  accion: string;
}): Promise<SesionCerrada> {
  const fila = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: { estado: true, turno: { select: { pacienteId: true } } },
  });
  if (!fila) throw new ApiError(MENSAJE_NO_ENCONTRADA, 404);
  if (!ESTADOS_SIN_TERMINAR.includes(fila.estado)) {
    throw new ApiError(MENSAJE_NO_SIN_TERMINAR, 409);
  }

  const { existe: conAudio } = await almacen.existe(keyAudio(organizationId, sesionId, 0));
  const resultado = conAudio && conservarConAudio ? "fallida" : "borrada";

  return prisma.$transaction(async (tx) => {
    if (resultado === "fallida") {
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
    } else {
      const { count } = await tx.sesionClinica.deleteMany({
        where: whereTransicion({ operacion: "abandonar_y_borrar", sesionId, organizationId }),
      });
      if (count === 0) throw new ApiError(MENSAJE_CONFLICTO, 409);
    }

    await crearTrabajo({
      prisma: tx,
      tipo: "borrar_audio_r2",
      payload: { prefijo: prefijoAudio(organizationId, sesionId), indices: [0] },
      organizationId,
      sesionId,
      pacienteId: fila.turno.pacienteId,
      ...(conAudio ? {} : { proximoIntentoEn: new Date(ahora.getTime() + ESPERA_BORRADO_SIN_AUDIO_MS) }),
    });

    await auditar(tx, {
      organizationId,
      actorTipo: actor.tipo,
      actorId: actor.id,
      accion,
      entidad: "sesion_clinica",
      entidadId: sesionId,
      creadoEn: ahora,
      detalle: { desde: fila.estado, hacia: resultado, conAudio },
    });

    return { resultado, conAudio };
  });
}

/** "Descartar" de la usuaria: la sesión desaparece, haya audio o no. */
export function descartarSesion({
  usuarioId,
  ...input
}: CerrarSinTerminarBase & { usuarioId: string }): Promise<SesionCerrada> {
  return cerrarSinTerminar({
    ...input,
    conservarConAudio: false,
    actor: { tipo: "usuario", id: usuarioId },
    accion: ACCION_DESCARTAR,
  });
}

/** La red de seguridad del mantenimiento: con audio queda `fallida`. */
export function abandonarSesion(input: CerrarSinTerminarBase): Promise<SesionCerrada> {
  return cerrarSinTerminar({
    ...input,
    conservarConAudio: true,
    actor: { tipo: "sistema", id: null },
    accion: ACCION_ABANDONAR,
  });
}
