import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { cifrarPaciente } from "@/lib/prisma-encryption";

import { getOrganizationId } from "../_lib/auth";
import { pacienteCreateSchema, toBooleanParam } from "../_lib/schemas";
import { errorResponse, ok, validationError } from "../_lib/responses";
import { toPacienteConDeuda } from "../_lib/domain";

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
    const parsed = pacienteCreateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // telefono ya viene normalizado a E.164 por el .transform del esquema.
    // Las notas van cifradas, atadas al id de la fila: por eso el id se
    // genera antes del create. `email` ya no existe en el esquema.
    const { notasEncrypted: _blob, ...paciente } = await db.paciente.create({
      data: {
        nombre: parsed.data.nombre,
        apellido: parsed.data.apellido,
        telefono: parsed.data.telefono,
        tarifa: parsed.data.tarifa,
        organizationId,
        ...cifrarPaciente(randomUUID(), { notas: parsed.data.notas ?? null }),
      },
    });
    void _blob;

    return ok(paciente, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
