// Endpoint M2M: el worker Python (processor/) entrega acá el resultado del
// procesamiento. Se autentica con PROCESSING_SECRET (Bearer token); está
// excluido del matcher de auth en src/middleware.ts.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  datosEstructuradosSchema,
  notaSoapSchema,
} from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../_lib/auditoria";
import { requireM2M } from "../../_lib/auth";
import { procesarCallback } from "../../_lib/casos-uso/procesar-callback";
import { errorResponse, validationError } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

/**
 * El worker en Python serializa `datos_estructurados` como string JSON;
 * otras versiones del cliente lo mandan ya como objeto. Aceptamos ambas
 * formas y null/undefined; un string que no parsea queda como string para
 * que la validación Zod (que espera objeto) emita un error claro.
 */
function normalizarDatosEstructurados(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

// Envoltorio del callback. La forma de la nota y de datosEstructurados es la
// del tablero (src/lib/sesion-clinica/schema.ts): única definición.
const callbackSchema = z.object({
  sesionClinicaId: z.string(),
  estado: z.enum(["revision", "error"]),
  transcripcion: z.string().optional(),
  nota: notaSoapSchema.optional(),
  datosEstructurados: z.preprocess(
    normalizarDatosEstructurados,
    datosEstructuradosSchema.optional(),
  ),
  modeloASR: z.string().optional(),
  modeloLLM: z.string().optional(),
  promptVersion: z.string().max(200).optional(),
  error: z.string().optional(),
});

export async function POST(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const body: unknown = await request.json();
    const parsed = callbackSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await procesarCallback({
      prisma: db,
      payload: parsed.data,
      registrarAuditoria,
    });

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
