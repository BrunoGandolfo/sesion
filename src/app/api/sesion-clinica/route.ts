import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";
import { sinClaveTemporal } from "../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  turnoId: z.string().cuid("Turno inválido"),
});

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const turnoId = new URL(request.url).searchParams.get("turnoId");

    if (!turnoId) {
      throw new ApiError("Falta turnoId", 400);
    }

    const sesion = await db.sesionClinica.findFirst({
      where: { turnoId, organizationId },
      select: {
        id: true,
        turnoId: true,
        estado: true,
        duracionAudioSeg: true,
        audioR2Key: true,
        createdAt: true,
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
        turno: {
          select: {
            id: true,
            paciente: {
              select: { id: true, nombre: true, apellido: true },
            },
          },
        },
      },
    });

    if (!sesion) {
      return ok(null);
    }

    // datosEstructurados sale como objeto y sin la clave temporal del audio.
    return ok(sinClaveTemporal(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.$transaction(async (tx) => {
      const turno = await tx.turno.findFirst({
        where: { id: parsed.data.turnoId, organizationId },
        select: { id: true, estado: true, pacienteId: true },
      });

      if (!turno) {
        throw new ApiError("Turno no encontrado", 404);
      }

      // Permitimos grabar durante un turno programado (la grabación cierra el
      // turno automáticamente al subir el audio) o sobre uno ya realizado que
      // no se grabó en su momento (caso edge, retrocompatibilidad).
      if (turno.estado !== "programado" && turno.estado !== "realizado") {
        throw new ApiError(
          "Solo se puede grabar sesiones de turnos programados o realizados",
          400,
        );
      }

      const existente = await tx.sesionClinica.findUnique({
        where: { turnoId: turno.id },
        select: { id: true },
      });

      if (existente) {
        throw new ApiError("El turno ya tiene una sesión clínica", 409);
      }

      const consentimiento = await tx.consentimientoGrabacion.findFirst({
        where: { pacienteId: turno.pacienteId, revocadoEn: null },
        select: { id: true },
      });

      if (!consentimiento) {
        throw new ApiError(
          "El paciente no tiene consentimiento de grabación vigente",
          400,
        );
      }

      return tx.sesionClinica.create({
        data: {
          turnoId: turno.id,
          organizationId,
          estado: "pendiente",
        },
      });
    });

    return ok(sesion, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
