import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { crearTurno } from "../_lib/casos-uso/crear-turno";
import { listarTurnos } from "../_lib/casos-uso/turnos";
import {
  isoDateTimeSchema,
  toBooleanParam,
  turnoCreateSchema,
} from "../_lib/schemas";
import { errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

const querySchema = z.object({
  desde: isoDateTimeSchema,
  hasta: isoDateTimeSchema,
  pacienteId: z.string().optional(),
  includeCancelados: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      desde: url.searchParams.get("desde") ?? "",
      hasta: url.searchParams.get("hasta") ?? "",
      pacienteId: url.searchParams.get("pacienteId") ?? undefined,
      includeCancelados: toBooleanParam(
        url.searchParams.get("includeCancelados"),
        false,
      ),
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const turnos = await listarTurnos({
      prisma: db,
      organizationId,
      desde: new Date(parsed.data.desde),
      hasta: new Date(parsed.data.hasta),
      pacienteId: parsed.data.pacienteId,
      includeCancelados: parsed.data.includeCancelados,
    });

    return ok(turnos);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = turnoCreateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const turno = await crearTurno({
      prisma: db,
      organizationId,
      pacienteId: parsed.data.pacienteId,
      fecha: new Date(parsed.data.fecha),
      duracion: parsed.data.duracion,
      modalidad: parsed.data.modalidad,
      notas: parsed.data.notas ?? null,
      frecuencia: parsed.data.frecuencia,
      ahora: new Date(),
    });

    return ok(turno, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
