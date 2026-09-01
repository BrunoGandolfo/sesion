import { z } from "zod";
import { db } from "@/lib/db";
import {
  ESTADOS_SESION,
  esSesionHuerfana,
  esTransicionPermitidaAlCliente,
} from "@/lib/sesion-clinica-utils";

import { borrarAudioBestEffort } from "../../_lib/audio";
import { getOrganizationId } from "../../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
import {
  assertTransicionValida,
  extraerClaveTemporal,
  sinClaveTemporal,
} from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Solo valida el shape del body. La validez de la transición la decide
// esTransicionPermitidaAlCliente (PATCH) o assertTransicionValida (DELETE),
// ambas sobre la tabla única de src/lib/sesion-clinica-utils.ts.
const estadoSchema = z.enum(
  ESTADOS_SESION as unknown as [string, ...string[]],
);

const updateSchema = z.object({
  estado: estadoSchema.optional(),
  duracionAudioSeg: z.number().int().nonnegative().optional(),
  audioR2Key: z.string().min(1).optional(),
});

// Select explícito de la sesión para la UI. NUNCA transcripcion: es PHI
// que la UI no necesita y no debe viajar por esta API.
const SESION_SELECT = {
  id: true,
  turnoId: true,
  estado: true,
  duracionAudioSeg: true,
  audioR2Key: true,
  audioBorradoEn: true,
  notaSubjetivo: true,
  notaObjetivo: true,
  notaAnalisis: true,
  notaPlan: true,
  datosEstructurados: true,
  modeloASR: true,
  modeloLLM: true,
  procesadoEn: true,
  aprobadoEn: true,
  error: true,
  intentos: true,
  createdAt: true,
  updatedAt: true,
  turno: {
    select: {
      id: true,
      fecha: true,
      paciente: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          telefono: true,
        },
      },
    },
  },
} as const;

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: SESION_SELECT,
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    return ok(sinClaveTemporal(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

const MENSAJE_AUDIO_NO_BORRADO =
  "No se pudo borrar el audio en R2; la sesión se conserva para reintentar la eliminación";

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const existente = await db.sesionClinica.findFirst({
      where: { id, organizationId },
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

    // Caso 1 — nota en revisión: descartar ≠ destruir. Se limpia SOLO lo
    // generado por el LLM (nota SOAP + datos estructurados); la transcripción
    // y el audio NO se tocan acá. La fila queda en "error", el único estado
    // reprocesable (error → procesando vía PATCH re-encola al worker).
    // El audio vive de la grabación a la aprobación (el worker ya no lo
    // borra al procesar); solo sesiones aprobadas antes de ese cambio pueden
    // tener audioR2Key apuntando a un objeto ya inexistente.
    if (existente.estado === "revision") {
      assertTransicionValida(existente.estado, "error");
      const audioConservado = Boolean(
        existente.audioR2Key && existente.audioR2Key !== "dev-no-r2",
      );
      // Se limpia todo lo generado, pero el stash de la clave temporal se
      // preserva (es lo único necesario para reprocesar). Escrito por el
      // campo LÓGICO datosEstructurados para que la extensión lo cifre —
      // escribir el *Encrypted directo saltea la extensión (anti-patrón);
      // con null el resultado es idéntico al comportamiento previo.
      const claveTemporal = extraerClaveTemporal(existente.datosEstructurados);
      await db.sesionClinica.update({
        where: { id },
        data: {
          estado: "error",
          notaSoapEncrypted: null,
          datosEstructurados: claveTemporal
            ? JSON.stringify({ _audioCifradoTemporal: claveTemporal })
            : null,
          error: audioConservado
            ? "Nota descartada por la usuaria. La transcripción y el audio se conservan: podés reprocesar o eliminar definitivamente."
            : "Nota descartada por la usuaria. La transcripción se conserva; no hay audio para reprocesar.",
        },
      });

      return ok({ success: true, estado: "error", audioConservado });
    }

    // Caso 2 — sesión en error: descarte definitivo. Ningún otro modelo
    // referencia SesionClinica (es el lado dependiente de la 1:1 con Turno),
    // así que el delete es seguro y libera el turno para volver a grabar.
    // Si el audio real no se pudo borrar de R2, la fila NO se elimina:
    // audioR2Key es el único puntero al blob y perderlo lo dejaría huérfano
    // e imborrable. La sesión queda en error con el motivo para reintentar.
    if (existente.estado === "error") {
      const audioBorrado = await borrarAudioBestEffort(existente.audioR2Key);
      const audioReal = Boolean(
        existente.audioR2Key && existente.audioR2Key !== "dev-no-r2",
      );
      if (!audioBorrado && audioReal) {
        await db.sesionClinica.update({
          where: { id },
          data: { error: MENSAJE_AUDIO_NO_BORRADO },
        });
        throw new ApiError(MENSAJE_AUDIO_NO_BORRADO, 409);
      }
      await db.sesionClinica.delete({ where: { id } });

      return ok({ success: true, eliminada: true });
    }

    // Caso 3 — grabación abandonada (huérfana en "grabando"): el umbral se
    // valida server-side para no permitir descartar una grabación activa.
    if (existente.estado === "grabando" && esSesionHuerfana(existente)) {
      if (existente.audioR2Key) {
        // Hay audio subido: conservamos fila y audio, transición a error
        // (desde ahí la usuaria puede reintentar o descartar definitivamente).
        assertTransicionValida(existente.estado, "error");
        await db.sesionClinica.update({
          where: { id },
          data: {
            estado: "error",
            error: "Grabación abandonada — descartada por la usuaria",
          },
        });

        return ok({ success: true, estado: "error" });
      }

      // Sin audio subido no hay nada que procesar ni conservar: eliminación
      // limpia, que además libera el turno (relación 1:1 por turnoId único).
      await db.sesionClinica.delete({ where: { id } });

      return ok({ success: true, eliminada: true });
    }

    throw new ApiError(
      `Solo se puede descartar una nota en revisión, una sesión con error o una grabación abandonada (estado actual: ${existente.estado})`,
      409,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existente = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: { id: true, estado: true, audioR2Key: true },
    });

    if (!existente) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    let esReintento = false;

    if (parsed.data.estado !== undefined) {
      // El PATCH solo acepta las transiciones que el navegador pide de
      // verdad (pendiente→grabando, grabando→error, error→procesando). Las
      // demás son válidas a nivel sistema pero tienen efectos que viven en
      // su propia ruta (upload, callback, aprobar, DELETE); permitirlas acá
      // sería un bypass de esos efectos.
      if (
        !esTransicionPermitidaAlCliente(existente.estado, parsed.data.estado)
      ) {
        throw new ApiError(
          `La transición ${existente.estado} → ${parsed.data.estado} no se puede pedir por PATCH: se realiza por su ruta específica (upload, callback, aprobar o DELETE).`,
          400,
        );
      }

      // Reintento error → procesando: el worker (processor/) levanta las
      // sesiones en "procesando" vía /pendientes, así que la transición
      // re-encola sola. Pero sin audio en R2 no hay nada que procesar y la
      // sesión quedaría colgada en "procesando" para siempre.
      esReintento =
        existente.estado === "error" && parsed.data.estado === "procesando";
      if (
        esReintento &&
        !parsed.data.audioR2Key &&
        !existente.audioR2Key
      ) {
        throw new ApiError(
          "No hay audio subido para reintentar el procesamiento. Descartá la sesión y volvé a grabar.",
          409,
        );
      }
    }

    const sesion = await db.sesionClinica.update({
      where: { id },
      data: {
        estado: parsed.data.estado,
        duracionAudioSeg: parsed.data.duracionAudioSeg,
        audioR2Key: parsed.data.audioR2Key,
        // Al reintentar se limpia el error anterior (mismo criterio que
        // upload/route.ts al pasar a "procesando") y se resetea el contador
        // de intentos: /pendientes lo usa como lease y tope (3); sin el
        // reset, una sesión que agotó los reintentos volvería a "error" en
        // el primer poll.
        ...(esReintento ? { error: null, intentos: 0 } : {}),
      },
      select: SESION_SELECT,
    });

    return ok(sinClaveTemporal(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}
