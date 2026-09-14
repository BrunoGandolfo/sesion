import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { crearPaciente, listarPacientes } from "../_lib/casos-uso/pacientes";
import { pacienteCreateSchema, toBooleanParam } from "../_lib/schemas";
import { errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  activo: z.boolean(),
  q: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      activo: toBooleanParam(url.searchParams.get("activo"), true),
      q: url.searchParams.get("q") ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const pacientes = await listarPacientes({
      prisma: db,
      organizationId,
      activo: parsed.data.activo,
      q: parsed.data.q,
    });

    return ok(pacientes);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = pacienteCreateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // telefono ya viene normalizado a E.164 por el .transform del esquema.
    const paciente = await crearPaciente({
      prisma: db,
      organizationId,
      datos: {
        nombre: parsed.data.nombre,
        apellido: parsed.data.apellido,
        telefono: parsed.data.telefono,
        tarifa: parsed.data.tarifa,
        notas: parsed.data.notas ?? null,
      },
    });

    return ok(paciente, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
