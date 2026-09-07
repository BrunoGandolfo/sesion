import { z } from "zod";
import { consentimientoVigenteDe } from "@/lib/consentimiento";
import { db } from "@/lib/db";

import { registrarAuditoria } from "../_lib/auditoria";
import { getOrganizationId, getSessionActor } from "../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";
import { SESION_SELECT, toSesionClinicaResponse } from "../_lib/sesion-clinica";

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
      select: SESION_SELECT,
    });

    if (!sesion) {
      return ok(null);
    }

    return ok(toSesionClinicaResponse(sesion));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const body: unknown = await request.json();
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

      // La organización va en la pregunta, no queda a criterio del llamador:
      // ver la nota en src/lib/consentimiento.ts. Antes acá se preguntaba
      // sólo por pacienteId.
      const autorizada = await consentimientoVigenteDe(
        tx,
        turno.pacienteId,
        organizationId,
      );

      if (!autorizada) {
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
        select: SESION_SELECT,
      });
    });

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.crear",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: { turnoId: sesion.turnoId },
    });

    return ok(toSesionClinicaResponse(sesion), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
