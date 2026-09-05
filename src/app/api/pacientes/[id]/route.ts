import { db } from "@/lib/db";
import type { Paciente } from "@/types/domain";

import { getOrganizationId } from "../../_lib/auth";
import { toPacienteConDeuda, toTurno } from "../../_lib/domain";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";
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

    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      include: {
        turnos: {
          orderBy: { fecha: "desc" },
        },
      },
    });

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    // Un solo envoltorio para toda la API: { data: { paciente, turnos } }.
    // Antes esta ruta devolvía `data` y `turnos` sueltos en la raíz, y era
    // la razón por la que la ficha no podía usar el cliente de API común.
    return ok({
      paciente: toPacienteConDeuda(paciente),
      turnos: paciente.turnos.map(toTurno),
    });
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

    // La organización va en el WHERE de la escritura, no sólo en un chequeo
    // previo: `update({ where: { id } })` escribe la fila aunque sea de otra
    // organización, y entre el chequeo y la escritura hay una ventana. Con
    // updateMany + count la pertenencia es parte de la operación.
    //
    // Los campos ausentes quedan undefined y Prisma no los toca; telefono, si
    // vino, ya está normalizado a E.164 por el esquema.
    const { count } = await db.paciente.updateMany({
      where: { id, organizationId },
      data: parsed.data,
    });

    if (count === 0) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const paciente = await db.paciente.findUniqueOrThrow({ where: { id } });

    return ok<Paciente>(paciente);
  } catch (error) {
    return errorResponse(error);
  }
}
