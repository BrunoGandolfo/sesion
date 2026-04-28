import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

// TODO: reemplazar el placeholder por la implementación real cuando exista.
// import { getTextoConsentimientoGrabacion } from "@/lib/consentimiento";

import { getOrganizationId } from "../../../_lib/auth";
import { ApiError, errorResponse, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type SqlClient = Prisma.TransactionClient | typeof db;

type ConsentimientoRow = {
  id: string;
  pacienteId: string;
  firmadoEn: Date;
  textoVersion: string;
  revocadoEn: Date | null;
};

const createConsentimientoSchema = z.object({
  firmaDigital: z.string().trim().min(1, "Falta la firma digital"),
  textoVersion: z.string().trim().min(1, "Falta la versión del texto"),
});

function getTextoConsentimientoPlaceholder(textoVersion: string) {
  return `Consentimiento de grabación versión ${textoVersion}. TODO: reemplazar este texto placeholder por el contenido real desde @/lib/consentimiento.`;
}

function toConsentimientoResponse(consentimiento: ConsentimientoRow) {
  return {
    id: consentimiento.id,
    pacienteId: consentimiento.pacienteId,
    firmadoEn: consentimiento.firmadoEn,
    textoVersion: consentimiento.textoVersion,
    vigente: consentimiento.revocadoEn === null,
  };
}

function getIpOrigen(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    const ip = firstIp?.trim();

    if (ip) {
      return ip;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("JSON inválido", 400);
  }
}

async function assertPacienteExists(id: string, organizationId: string) {
  const paciente = await db.paciente.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });

  if (!paciente) {
    throw new ApiError("Paciente no encontrado", 404);
  }
}

async function findLatestConsentimiento(
  client: SqlClient,
  pacienteId: string,
  organizationId: string,
) {
  const consentimientos = await client.$queryRaw<ConsentimientoRow[]>`
    SELECT "id", "pacienteId", "firmadoEn", "textoVersion", "revocadoEn"
    FROM "consentimientos_grabacion"
    WHERE "pacienteId" = ${pacienteId}
      AND "organizationId" = ${organizationId}
    ORDER BY "firmadoEn" DESC
    LIMIT 1
  `;

  return consentimientos[0] ?? null;
}

async function findVigenteConsentimiento(
  client: SqlClient,
  pacienteId: string,
  organizationId: string,
) {
  const consentimientos = await client.$queryRaw<ConsentimientoRow[]>`
    SELECT "id", "pacienteId", "firmadoEn", "textoVersion", "revocadoEn"
    FROM "consentimientos_grabacion"
    WHERE "pacienteId" = ${pacienteId}
      AND "organizationId" = ${organizationId}
      AND "revocadoEn" IS NULL
    ORDER BY "firmadoEn" DESC
    LIMIT 1
  `;

  return consentimientos[0] ?? null;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    const consentimiento = await findLatestConsentimiento(db, id, organizationId);

    if (!consentimiento || consentimiento.revocadoEn !== null) {
      return Response.json({ consentimiento: null });
    }

    return Response.json({
      consentimiento: toConsentimientoResponse(consentimiento),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    const body = await parseJsonBody(request);
    const parsed = createConsentimientoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const now = new Date();
    const consentimientoId = randomUUID();
    const ipOrigen = getIpOrigen(request);

    const consentimiento = await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "consentimientos_grabacion"
        SET "revocadoEn" = ${now}, "updatedAt" = ${now}
        WHERE "pacienteId" = ${id}
          AND "organizationId" = ${organizationId}
          AND "revocadoEn" IS NULL
      `;

      const created = await tx.$queryRaw<ConsentimientoRow[]>`
        INSERT INTO "consentimientos_grabacion" (
          "id",
          "pacienteId",
          "organizationId",
          "firmadoEn",
          "revocadoEn",
          "textoVersion",
          "textoCompleto",
          "firmaDigital",
          "ipOrigen",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${consentimientoId},
          ${id},
          ${organizationId},
          ${now},
          ${null},
          ${parsed.data.textoVersion},
          ${getTextoConsentimientoPlaceholder(parsed.data.textoVersion)},
          ${parsed.data.firmaDigital},
          ${ipOrigen},
          ${now},
          ${now}
        )
        RETURNING "id", "pacienteId", "firmadoEn", "textoVersion", "revocadoEn"
      `;

      const [nuevoConsentimiento] = created;

      if (!nuevoConsentimiento) {
        throw new ApiError("No se pudo registrar el consentimiento", 500);
      }

      return nuevoConsentimiento;
    });

    return Response.json(
      { consentimiento: toConsentimientoResponse(consentimiento) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    await db.$transaction(async (tx) => {
      const consentimiento = await findVigenteConsentimiento(tx, id, organizationId);

      if (!consentimiento) {
        throw new ApiError("Consentimiento vigente no encontrado", 404);
      }

      const now = new Date();

      await tx.$executeRaw`
        UPDATE "consentimientos_grabacion"
        SET "revocadoEn" = ${now}, "updatedAt" = ${now}
        WHERE "pacienteId" = ${id}
          AND "organizationId" = ${organizationId}
          AND "revocadoEn" IS NULL
      `;
    });

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
