// TODO: agregar `api/sesion-clinica/callback` a las exclusiones del matcher en
// src/middleware.ts. Este endpoint se autentica machine-to-machine con
// PROCESSING_SECRET (Bearer token), no con sesión de usuario.

import { z } from "zod";
import { db } from "@/lib/db";

import { errorResponse, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notaSchema = z.object({
  subjetivo: z.string(),
  objetivo: z.string(),
  analisis: z.string(),
  plan: z.string(),
});

const datosEstructuradosSchema = z.object({
  temas: z.array(z.string()),
  emocionesPaciente: z.array(z.string()),
  intensidadEmocional: z.number(),
  alianzaTerapeutica: z.enum(["fragil", "inestable", "estable", "fuerte"]),
  intervenciones: z.array(z.string()),
  compromisos: z.array(z.string()),
  senalesAlerta: z.array(z.string()),
  progresoPercibido: z.string(),
});

const callbackSchema = z.object({
  sesionClinicaId: z.string(),
  estado: z.enum(["revision", "error"]),
  transcripcion: z.string().optional(),
  nota: notaSchema.optional(),
  datosEstructurados: datosEstructuradosSchema.optional(),
  modeloASR: z.string().optional(),
  modeloLLM: z.string().optional(),
  error: z.string().optional(),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.PROCESSING_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = callbackSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.sesionClinica.findUnique({
      where: { id: parsed.data.sesionClinicaId },
      select: { id: true, estado: true, intentos: true },
    });

    if (!sesion) {
      return Response.json(
        { error: "Sesión clínica no encontrada" },
        { status: 404 },
      );
    }

    const ahora = new Date();
    const esError = parsed.data.estado === "error";

    await db.sesionClinica.update({
      where: { id: sesion.id },
      data: {
        estado: parsed.data.estado,
        transcripcion: parsed.data.transcripcion,
        notaSubjetivo: parsed.data.nota?.subjetivo,
        notaObjetivo: parsed.data.nota?.objetivo,
        notaAnalisis: parsed.data.nota?.analisis,
        notaPlan: parsed.data.nota?.plan,
        datosEstructurados: parsed.data.datosEstructurados
          ? JSON.stringify(parsed.data.datosEstructurados)
          : undefined,
        modeloASR: parsed.data.modeloASR,
        modeloLLM: parsed.data.modeloLLM,
        procesadoEn: ahora,
        error: esError ? parsed.data.error ?? null : null,
        intentos: esError ? sesion.intentos + 1 : undefined,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
