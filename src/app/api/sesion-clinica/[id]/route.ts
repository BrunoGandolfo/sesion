import { z } from "zod";
import { db } from "@/lib/db";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";

import { borrarAudioBestEffort } from "../../_lib/audio";
import { getOrganizationId } from "../../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const estadoSchema = z.enum([
  "pendiente",
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobado",
  "error",
]);

type Estado = z.infer<typeof estadoSchema>;

const transicionesPermitidas: Record<Estado, Estado[]> = {
  pendiente: ["grabando"],
  grabando: ["subiendo"],
  subiendo: ["procesando"],
  procesando: ["revision", "error"],
  revision: [],
  aprobado: [],
  error: ["procesando"],
};

const updateSchema = z.object({
  estado: estadoSchema.optional(),
  duracionAudioSeg: z.number().int().nonnegative().optional(),
  audioR2Key: z.string().min(1).optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      include: {
        turno: {
          include: {
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
      },
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}

// Stash de la clave temporal de cifrado del audio: upload lo guarda en
// datosEstructurados._audioCifradoTemporal y pendientes lo lee para el
// worker. Debe vivir exactamente lo que vive el audio — si el descarte lo
// mata, el reproceso queda colgado (pendientes devuelve claveCifrado null y
// el worker ignora el item). Mismo manejo tolerante string/objeto que
// extraerClaveTemporal() en callback/route.ts.
function extraerClaveTemporal(raw: unknown): unknown {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return (parsed as Record<string, unknown>)._audioCifradoTemporal ?? null;
}

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
    if (existente.estado === "error") {
      await borrarAudioBestEffort(existente.audioR2Key);
      await db.sesionClinica.delete({ where: { id } });

      return ok({ success: true, eliminada: true });
    }

    // Caso 3 — grabación abandonada (huérfana en "grabando"): el umbral se
    // valida server-side para no permitir descartar una grabación activa.
    if (existente.estado === "grabando" && esSesionHuerfana(existente)) {
      if (existente.audioR2Key) {
        // Hay audio subido: conservamos fila y audio, transición a error
        // (desde ahí la usuaria puede reintentar o descartar definitivamente).
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
      const desde = existente.estado as Estado;
      const permitidas = transicionesPermitidas[desde] ?? [];
      if (!permitidas.includes(parsed.data.estado)) {
        throw new ApiError(
          `Transición inválida: ${existente.estado} → ${parsed.data.estado}`,
          400,
        );
      }

      // Reintento error → procesando: el worker (processor/) levanta las
      // sesiones en "procesando" vía /pendientes, así que la transición
      // re-encola sola. Pero sin audio en R2 no hay nada que procesar y la
      // sesión quedaría colgada en "procesando" para siempre.
      esReintento = desde === "error" && parsed.data.estado === "procesando";
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
        // upload/route.ts al pasar a "procesando").
        ...(esReintento ? { error: null } : {}),
      },
    });

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}
