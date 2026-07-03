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

const intervencionSchema = z.object({
  tipo: z.enum([
    "reformulacion",
    "senalamiento",
    "confrontacion",
    "interpretacion",
    "pregunta_circular",
    "validacion",
    "silencio_terapeutico",
    "otra",
  ]),
  descripcion: z.string(),
  timestampAprox: z.string().optional(),
});

const flagsRiesgoSchema = z.object({
  ideacionSuicida: z.boolean(),
  autolesion: z.boolean(),
  violenciaTerceros: z.boolean(),
  sintomasPsicoticos: z.boolean(),
  crisisPanico: z.boolean(),
  detalle: z.string(),
});

// Contrato de riesgo clínico (docs/contrato-riesgo-clinico.md): el campo es
// best-effort y nunca debe bloquear la nota — por eso lleva .catch(undefined):
// un shape inválido se descarta (los lectores lo normalizan a nivel "ninguno")
// en vez de rechazar el callback entero.
const evidenciaRiesgoSchema = z.object({
  timestamp: z.string(),
  quote: z.string(),
});

const riesgoDetectadoSchema = z.object({
  nivel: z.enum(["ninguno", "bajo", "moderado", "alto"]),
  indicadores: z.array(z.string()),
  evidencia: z.array(evidenciaRiesgoSchema),
  notaParaTerapeuta: z.string().nullable(),
});

const speechAnalyticsSchema = z.object({
  ratioHablaTerapeuta: z.number(),
  ratioHablaPaciente: z.number(),
  cantidadSilencios: z.number(),
  duracionPromedioSilenciosSeg: z.number(),
  tiempoTotalHablaSeg: z.number(),
});

const datosEstructuradosSchema = z.object({
  temas: z.array(z.string()).optional(),
  emocionesPaciente: z.array(z.string()).optional(),
  intensidadEmocional: z.number().min(1).max(10).optional(),
  alianzaTerapeutica: z
    .enum(["fragil", "inestable", "estable", "fuerte"])
    .optional(),
  intervenciones: z.array(intervencionSchema).optional(),
  compromisos: z.array(z.string()).optional(),
  progresoPercibido: z.string().optional(),
  materialRecurrente: z.array(z.string()).optional(),
  materialNuevo: z.array(z.string()).optional(),
  focoProximaSesion: z.string().optional(),
  flagsRiesgo: flagsRiesgoSchema.optional(),
  riesgoDetectado: riesgoDetectadoSchema.optional().catch(undefined),
  // Unión discriminada por orientación (docs/contrato-multi-orientacion.md):
  // el shape se valida al LEER con normalizarFeedback, acá solo se preserva.
  feedbackTerapeuta: z.unknown().optional(),
  confianzaModelo: z.enum(["alta", "media", "baja"]).optional(),
  resumenSesion: z.string().optional(),
  estadoEmocionalObservado: z.string().optional(),
  duracionRealMin: z.number().optional(),
  speechAnalytics: speechAnalyticsSchema.optional(),
  observacionIA: z.string().optional(),
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

/**
 * El worker en Python serializa `datos_estructurados` como string JSON;
 * otras versiones del cliente lo mandan ya como objeto. Aceptamos ambas
 * formas y null/undefined; un string que no parsea queda como string para
 * que la validación Zod (que espera objeto) emita un error claro.
 */
function normalizeDatosEstructurados(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (body && typeof body === "object" && "datosEstructurados" in body) {
      (body as Record<string, unknown>).datosEstructurados =
        normalizeDatosEstructurados(
          (body as Record<string, unknown>).datosEstructurados,
        );
    }
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
