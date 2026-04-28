import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const notaSchema = z.object({
  subjetivo: z.string(),
  objetivo: z.string(),
  analisis: z.string(),
  plan: z.string(),
});

const aprobarSchema = z.object({
  notaEditada: notaSchema.optional(),
  notasEdicion: z.string().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = aprobarSchema.safeParse(body);

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

    if (existente.estado !== "revision") {
      throw new ApiError(
        "Solo se pueden aprobar notas en estado revisión",
        400,
      );
    }

    const sesion = await db.sesionClinica.update({
      where: { id },
      data: {
        estado: "aprobado",
        aprobadoEn: new Date(),
        notasEdicion: parsed.data.notasEdicion,
        notaSubjetivo: parsed.data.notaEditada?.subjetivo,
        notaObjetivo: parsed.data.notaEditada?.objetivo,
        notaAnalisis: parsed.data.notaEditada?.analisis,
        notaPlan: parsed.data.notaEditada?.plan,
      },
    });

    return ok(sesion);
  } catch (error) {
    return errorResponse(error);
  }
}
