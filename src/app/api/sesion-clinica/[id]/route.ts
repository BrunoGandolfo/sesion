import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const estadoSchema = z.enum([
  "pendiente",
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobado",
  "error",
]);

type Estado = z.infer<typeof estadoSchema>;

const transicionesPermitidas: Record<Estado, Estado[]> = {
  pendiente: ["grabando"],
  grabando: ["subiendo"],
  subiendo: ["procesando"],
  procesando: ["revision", "error"],
  revision: [],
  aprobado: [],
  error: ["procesando"],
};

const updateSchema = z.object({
  estado: estadoSchema.optional(),
  duracionAudioSeg: z.number().int().nonnegative().optional(),
  audioR2Key: z.string().min(1).optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      include: {
        turno: {
          include: {
            paciente: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                telefono: true,
              },
            },
          },
        },
      },
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const existente = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: { id: true, estado: true },
    });

    if (!existente) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    if (existente.estado !== "revision") {
      throw new ApiError(
        `Solo se puede descartar una nota en revisión (estado actual: ${existente.estado})`,
        409,
      );
    }

    await db.sesionClinica.update({
      where: { id },
      data: {
        estado: "error",
        notaSoapEncrypted: null,
        datosEstructuradosEncrypted: null,
        transcripcionEncrypted: null,
      },
    });

    return ok({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existente = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: { id: true, estado: true },
    });

    if (!existente) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    if (parsed.data.estado !== undefined) {
      const desde = existente.estado as Estado;
      const permitidas = transicionesPermitidas[desde] ?? [];
      if (!permitidas.includes(parsed.data.estado)) {
        throw new ApiError(
          `Transición inválida: ${existente.estado} → ${parsed.data.estado}`,
          400,
        );
      }
    }

    const sesion = await db.sesionClinica.update({
      where: { id },
      data: {
        estado: parsed.data.estado,
        duracionAudioSeg: parsed.data.duracionAudioSeg,
        audioR2Key: parsed.data.audioR2Key,
      },
    });

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}
