import { z } from "zod";
import { db } from "@/lib/db";
import { estadoSesionSchema } from "@/lib/sesion-clinica/schema";
import { esTransicionPermitidaAlCliente } from "@/lib/sesion-clinica-utils";

import { borrarAudioBestEffort } from "../../_lib/audio";
import { registrarAuditoria } from "../../_lib/auditoria";
import { getSessionActor } from "../../_lib/auth";
import {
  ACCIONES_ELIMINAR,
  eliminarSesion,
  type AccionEliminar,
} from "../../_lib/casos-uso/eliminar-sesion";
import { reintentarSesion } from "../../_lib/casos-uso/reintentar-sesion";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
import { SESION_SELECT, toSesionClinicaResponse } from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Solo valida el shape del body. La validez de la transición la decide
// esTransicionPermitidaAlCliente (PATCH) o assertTransicionValida (casos de
// uso), ambas sobre la tabla única de src/lib/sesion-clinica-utils.ts.
const updateSchema = z.object({
  estado: estadoSesionSchema.optional(),
  duracionAudioSeg: z.number().int().nonnegative().optional(),
  audioR2Key: z.string().min(1).optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: SESION_SELECT,
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.ver",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: { estado: sesion.estado },
    });

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * La intención viaja en la query (`?accion=descartar|eliminar`) y no en el
 * cuerpo: un DELETE con body no lo reenvían todos los intermediarios, y así
 * la acción queda escrita en la propia URL del pedido.
 *
 * Es obligatoria. Sin ella el estado de la fila volvería a decidir solo, que
 * es exactamente lo que se está sacando (ver la cabecera del caso de uso).
 */
function accionDe(request: Request): AccionEliminar {
  const valor = new URL(request.url).searchParams.get("accion");

  if (!esAccionEliminar(valor)) {
    throw new ApiError(
      `Falta decir qué se está pidiendo: accion=${ACCIONES_ELIMINAR.join(" o ")}`,
      400,
    );
  }

  return valor;
}

function esAccionEliminar(valor: unknown): valor is AccionEliminar {
  return (
    typeof valor === "string" &&
    (ACCIONES_ELIMINAR as readonly string[]).includes(valor)
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const accion = accionDe(request);

    const resultado = await eliminarSesion({
      prisma: db,
      sesionId: id,
      organizationId,
      usuarioId: userId,
      accion,
      borrarAudio: borrarAudioBestEffort,
      registrarAuditoria,
    });

    // Cuerpos idénticos a los que devolvía cada rama del DELETE original.
    switch (resultado.tipo) {
      case "nota_descartada":
        return ok({
          success: true,
          estado: "error",
          audioConservado: resultado.audioConservado,
        });
      case "grabacion_abandonada_a_error":
        return ok({ success: true, estado: "error" });
      case "eliminada":
        return ok({ success: true, eliminada: true });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const body: unknown = await request.json();
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

    if (parsed.data.estado !== undefined) {
      // El PATCH solo acepta las transiciones que el navegador pide de
      // verdad (pendiente→grabando, grabando→error, subiendo→grabando,
      // error→procesando). Las demás son válidas a nivel sistema pero tienen
      // efectos que viven en su propia ruta (upload-url, upload-confirmar,
      // callback, aprobar, DELETE); permitirlas acá sería un bypass.
      if (
        !esTransicionPermitidaAlCliente(existente.estado, parsed.data.estado)
      ) {
        throw new ApiError(
          `La transición ${existente.estado} → ${parsed.data.estado} no se puede pedir por PATCH: se realiza por su ruta específica (upload-url, upload-confirmar, callback, aprobar o DELETE).`,
          400,
        );
      }

      // Reintento error → procesando: caso de uso propio (exige audio,
      // limpia el error, resetea intentos y audita el cambio de estado).
      if (existente.estado === "error" && parsed.data.estado === "procesando") {
        const sesion = await reintentarSesion({
          prisma: db,
          sesionId: id,
          organizationId,
          usuarioId: userId,
          audioR2Key: parsed.data.audioR2Key,
          duracionAudioSeg: parsed.data.duracionAudioSeg,
          registrarAuditoria,
        });
        return ok(toSesionClinicaResponse(sesion));
      }
    }

    // La organización va en el WHERE de la escritura y no sólo en el
    // findFirst de arriba: `update({ where: { id } })` escribe la fila aunque
    // sea de otra organización, y entre la lectura y la escritura hay una
    // ventana. Con updateMany + count la pertenencia es parte de la operación.
    const { count } = await db.sesionClinica.updateMany({
      where: { id, organizationId },
      data: {
        estado: parsed.data.estado,
        duracionAudioSeg: parsed.data.duracionAudioSeg,
        audioR2Key: parsed.data.audioR2Key,
      },
    });

    if (count === 0) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    const sesion = await db.sesionClinica.findUniqueOrThrow({
      where: { id },
      select: SESION_SELECT,
    });

    // Solo se audita el cambio de estado: un PATCH de duracion/audioR2Key
    // sin `estado` no es una transición.
    if (
      parsed.data.estado !== undefined &&
      parsed.data.estado !== existente.estado
    ) {
      await registrarAuditoria({
        organizationId,
        actorTipo: "usuario",
        actorId: userId,
        accion: "sesion.cambiar_estado",
        entidad: "sesion_clinica",
        entidadId: sesion.id,
        detalle: { desde: existente.estado, hacia: parsed.data.estado },
      });
    }

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}
