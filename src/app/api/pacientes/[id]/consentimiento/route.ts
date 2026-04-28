import { z } from "zod";
import { db } from "@/lib/db";
import { generarTextoConsentimiento } from "@/lib/consentimiento";

import { getOrganizationId } from "../../../_lib/auth";
import { ApiError, errorResponse, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ConsentimientoResponseInput = {
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

const consentimientoSelect = {
  id: true,
  pacienteId: true,
  firmadoEn: true,
  textoVersion: true,
  revocadoEn: true,
} as const;

function toConsentimientoResponse(consentimiento: ConsentimientoResponseInput) {
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

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    const consentimiento = await db.consentimientoGrabacion.findFirst({
      where: {
        pacienteId: id,
        organizationId,
        revocadoEn: null,
      },
      orderBy: { firmadoEn: "desc" },
      select: consentimientoSelect,
    });

    if (!consentimiento) {
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

    const body = await parseJsonBody(request);
    const parsed = createConsentimientoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const [paciente, configuracion] = await Promise.all([
      db.paciente.findFirst({
        where: { id, organizationId },
        select: { id: true, nombre: true, apellido: true },
      }),
      db.configuracion.findUnique({
        where: { organizationId },
        select: { nombreProfesional: true, direccion: true },
      }),
    ]);

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    if (!configuracion) {
      throw new ApiError("Configuración de la organización no encontrada", 500);
    }

    const textoCompleto = generarTextoConsentimiento({
      nombrePaciente: `${paciente.nombre} ${paciente.apellido}`.trim(),
      nombreProfesional: configuracion.nombreProfesional,
      direccionConsultorio: configuracion.direccion,
    });

    const ipOrigen = getIpOrigen(request);
    const now = new Date();

    const consentimiento = await db.$transaction(async (tx) => {
      await tx.consentimientoGrabacion.updateMany({
        where: {
          pacienteId: id,
          organizationId,
          revocadoEn: null,
        },
        data: { revocadoEn: now },
      });

      return tx.consentimientoGrabacion.create({
        data: {
          pacienteId: id,
          organizationId,
          firmadoEn: now,
          textoVersion: parsed.data.textoVersion,
          textoCompleto,
          firmaDigital: parsed.data.firmaDigital,
          ipOrigen,
        },
        select: consentimientoSelect,
      });
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

    const { count } = await db.consentimientoGrabacion.updateMany({
      where: {
        pacienteId: id,
        organizationId,
        revocadoEn: null,
      },
      data: { revocadoEn: new Date() },
    });

    if (count === 0) {
      throw new ApiError("Consentimiento vigente no encontrado", 404);
    }

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
