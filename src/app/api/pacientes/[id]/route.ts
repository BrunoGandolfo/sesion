import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { actualizarPaciente, obtenerPaciente } from "../../_lib/casos-uso/pacientes";
import { errorResponse, ok, validationError } from "../../_lib/responses";
import { pacienteUpdateSchema } from "../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    // Un solo envoltorio para toda la API: { data: { paciente, turnos } }.
    const ficha = await obtenerPaciente({ prisma: db, organizationId, pacienteId: id });

    return ok(ficha);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = pacienteUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // telefono, si vino, ya está normalizado a E.164 por el esquema.
    const paciente = await actualizarPaciente({
      prisma: db,
      organizationId,
      pacienteId: id,
      cambios: parsed.data,
    });

    return ok(paciente);
  } catch (error) {
    return errorResponse(error);
  }
}
