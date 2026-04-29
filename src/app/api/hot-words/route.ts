import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scopeSchema = z.enum(["global", "profesional", "paciente"]);

const itemSchema = z
  .object({
    termino: z.string().trim().min(1).max(200),
    scope: scopeSchema,
    categoria: z.string().trim().max(50).nullish(),
    pacienteId: z.string().cuid().nullish(),
  })
  .refine(
    (v) => (v.scope === "paciente" ? !!v.pacienteId : !v.pacienteId),
    {
      message:
        "pacienteId es obligatorio solo cuando scope === 'paciente'",
      path: ["pacienteId"],
    },
  );

const bulkSchema = z.object({
  hotWords: z.array(itemSchema).min(1),
});

const querySchema = z.object({
  scope: scopeSchema,
  pacienteId: z.string().cuid().optional(),
});

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);

    const parsed = querySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      pacienteId: url.searchParams.get("pacienteId") ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    if (parsed.data.scope === "paciente" && !parsed.data.pacienteId) {
      throw new ApiError(
        "pacienteId es obligatorio cuando scope === 'paciente'",
        400,
      );
    }

    const where: Prisma.HotWordWhereInput = {
      organizationId,
      scope: parsed.data.scope,
    };

    if (parsed.data.scope === "paciente") {
      where.pacienteId = parsed.data.pacienteId;
    } else {
      where.pacienteId = null;
    }

    const hotWords = await db.hotWord.findMany({
      where,
      select: {
        id: true,
        termino: true,
        scope: true,
        categoria: true,
        activo: true,
      },
      orderBy: { termino: "asc" },
    });

    return ok(hotWords);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body: unknown = await request.json();

    if (typeof body === "object" && body !== null && "hotWords" in body) {
      const parsed = bulkSchema.safeParse(body);
      if (!parsed.success) {
        return validationError(parsed.error);
      }

      await assertPacientesExisten(parsed.data.hotWords, organizationId);

      const result = await db.hotWord.createMany({
        data: parsed.data.hotWords.map((h) => ({
          organizationId,
          termino: h.termino,
          scope: h.scope,
          categoria: h.categoria ?? null,
          pacienteId: h.scope === "paciente" ? h.pacienteId ?? null : null,
        })),
        skipDuplicates: true,
      });

      return ok({ count: result.count }, 201);
    }

    const parsed = itemSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await assertPacientesExisten([parsed.data], organizationId);

    try {
      const hotWord = await db.hotWord.create({
        data: {
          organizationId,
          termino: parsed.data.termino,
          scope: parsed.data.scope,
          categoria: parsed.data.categoria ?? null,
          pacienteId:
            parsed.data.scope === "paciente"
              ? parsed.data.pacienteId ?? null
              : null,
        },
        select: {
          id: true,
          termino: true,
          scope: true,
          categoria: true,
          activo: true,
        },
      });
      return ok(hotWord, 201);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ApiError("Hot word duplicado", 409);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

async function assertPacientesExisten(
  items: Array<{ scope: string; pacienteId?: string | null }>,
  organizationId: string,
) {
  const ids = Array.from(
    new Set(
      items
        .filter((i) => i.scope === "paciente" && i.pacienteId)
        .map((i) => i.pacienteId as string),
    ),
  );

  if (ids.length === 0) return;

  const pacientes = await db.paciente.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });

  if (pacientes.length !== ids.length) {
    throw new ApiError("Paciente no encontrado", 404);
  }
}
