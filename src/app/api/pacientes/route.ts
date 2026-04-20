import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Paciente } from "@/types/domain";

import { getOrganizationId } from "../_lib/auth";
import { toBooleanParam } from "../_lib/schemas";
import { errorResponse, ok, validationError } from "../_lib/responses";
import { toPacienteConDeuda } from "../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  activo: z.boolean(),
  q: z.string().trim().optional(),
});

const optionalEmailSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().email().nullable().optional(),
);

const createPacienteSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  apellido: z.string().trim().min(1, "Falta el apellido"),
  telefono: z.string().trim().min(1, "Falta el teléfono"),
  email: optionalEmailSchema,
  tarifa: z.number().int().min(0, "La tarifa no puede ser negativa"),
  notas: z.string().trim().nullable().optional(),
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

    const where: Prisma.PacienteWhereInput = {
      organizationId,
      activo: parsed.data.activo,
    };

    if (parsed.data.q) {
      where.OR = [
        { nombre: { contains: parsed.data.q, mode: "insensitive" } },
        { apellido: { contains: parsed.data.q, mode: "insensitive" } },
      ];
    }

    const pacientes = await db.paciente.findMany({
      where,
      include: {
        turnos: {
          select: {
            fecha: true,
            estado: true,
            pagoEstado: true,
            tarifaCobrada: true,
          },
        },
      },
      orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
    });

    return ok(pacientes.map(toPacienteConDeuda));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = createPacienteSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const paciente = await db.paciente.create({
      data: {
        nombre: parsed.data.nombre,
        apellido: parsed.data.apellido,
        telefono: parsed.data.telefono,
        email: parsed.data.email ?? null,
        tarifa: parsed.data.tarifa,
        notas: parsed.data.notas ?? null,
        organizationId,
      },
    });

    return ok<Paciente>(paciente, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
