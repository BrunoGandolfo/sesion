import { z } from "zod";
import { db } from "@/lib/db";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";

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

// Best-effort: borra el audio cifrado de R2 antes de eliminar la fila.
// Import dinámico (mismo patrón que upload/route.ts) para tolerar entornos
// de desarrollo sin R2 configurado.
async function borrarAudioBestEffort(audioR2Key: string | null): Promise<void> {
  if (!audioR2Key || audioR2Key === "dev-no-r2") return;
  try {
    const r2 = await import("@/lib/r2");
    if (r2.r2Configurado()) {
      await r2.borrarAudio(audioR2Key);
    }
  } catch (error) {
    console.warn(
      "[sesion-clinica/DELETE] No se pudo borrar el audio de R2; se continúa con el descarte.",
      { audioR2Key, error },
    );
  }
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
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!existente) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    // Caso 1 — nota en revisión (comportamiento preexistente): descarte
    // "suave", se limpia la nota generada y la fila queda en error para que
    // la usuaria pueda reintentar o descartar definitivamente.
    if (existente.estado === "revision") {
      await db.sesionClinica.update({
        where: { id },
        data: {
          estado: "error",
          notaSoapEncrypted: null,
          datosEstructuradosEncrypted: null,
          transcripcionEncrypted: null,
        },
      });

      return ok({ success: true });
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
