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
import { errorResponse, validationError } from "../../_lib/responses";
import { extraerClaveTemporal } from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// Fila previa que necesita el callback. `notaSoapOriginal` es un campo
// lógico de la extensión de cifrado (sin columna legacy): vive en una const
// y no en un literal inline para que TS no lo rechace como propiedad
// sobrante del tipo generado; la extensión lo traduce a la columna cifrada.
const SESION_PREVIA_SELECT = {
  id: true,
  estado: true,
  intentos: true,
  organizationId: true,
  datosEstructurados: true,
  notaSoapOriginal: true,
} as const;

export async function POST(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const body: unknown = await request.json();
    const parsed = callbackSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.sesionClinica.findUnique({
      where: { id: parsed.data.sesionClinicaId },
      select: SESION_PREVIA_SELECT,
    });

    if (!sesion) {
      return Response.json(
        { error: "Sesión clínica no encontrada" },
        { status: 404 },
      );
    }

    const ahora = new Date();
    const esError = parsed.data.estado === "error";

    // Re-adjuntar la clave temporal del audio al persistir el resultado.
    // La clave (upload-url la guarda en datosEstructurados._audioCifradoTemporal;
    // pendientes la lee para el worker) debe vivir exactamente lo que vive el
    // audio: hasta la aprobación de la nota o la eliminación definitiva. El
    // resultado del LLM no la trae y el schema Zod la descarta, así que se
    // re-adjunta desde la fila previa — sin esto, el audio en "revision"
    // queda vivo pero indescifrable y el reproceso tras un descarte es
    // imposible. En callbacks de error datosEstructurados viene undefined y
    // la columna no se toca, así que la clave ya sobrevive.
    const claveTemporal = parsed.data.datosEstructurados
      ? extraerClaveTemporal(sesion.datosEstructurados)
      : null;

    // notaSoapOriginal se escribe UNA sola vez: la primera nota que llega del
    // worker. En un reproceso (descarte → error → procesando → callback) la
    // fila ya la tiene y NO se pisa: es el registro de "qué generó la IA"
    // antes de cualquier intervención humana. El tipo generado por Prisma no
    // conoce el campo lógico; el narrowing con `in` lo expone sin cast.
    const notaOriginalPrevia =
      "notaSoapOriginal" in sesion ? sesion.notaSoapOriginal : null;
    const escribirNotaOriginal =
      notaOriginalPrevia == null && parsed.data.nota !== undefined;

    // Objeto NO literal en la llamada: TS solo aplica el chequeo de
    // propiedades sobrantes a literales frescos, y notaSoapOriginal no existe
    // en el tipo generado (la extensión la consume antes de llegar a Prisma).
    const data = {
      estado: parsed.data.estado,
      transcripcion: parsed.data.transcripcion,
      notaSubjetivo: parsed.data.nota?.subjetivo,
      notaObjetivo: parsed.data.nota?.objetivo,
      notaAnalisis: parsed.data.nota?.analisis,
      notaPlan: parsed.data.nota?.plan,
      ...(escribirNotaOriginal ? { notaSoapOriginal: parsed.data.nota } : {}),
      // Convención del worker: la terapeuta es siempre el hablante S0.
      ...(parsed.data.nota ? { hablanteTerapeuta: "S0" } : {}),
      datosEstructurados: parsed.data.datosEstructurados
        ? JSON.stringify(
            claveTemporal
              ? {
                  ...parsed.data.datosEstructurados,
                  _audioCifradoTemporal: claveTemporal,
                }
              : parsed.data.datosEstructurados,
          )
        : undefined,
      modeloASR: parsed.data.modeloASR,
      modeloLLM: parsed.data.modeloLLM,
      promptVersion: parsed.data.promptVersion,
      procesadoEn: ahora,
      error: esError ? parsed.data.error ?? null : null,
      intentos: esError ? sesion.intentos + 1 : undefined,
    };

    // Escritura condicionada al estado: solo se acepta el resultado si la
    // sesión sigue en "procesando". Un callback tardío (lease vencido y
    // re-entregado, sesión descartada/reintentada mientras tanto) no pisa
    // nada. updateMany pasa por la extensión de cifrado igual que update.
    const { count } = await db.sesionClinica.updateMany({
      where: { id: sesion.id, estado: "procesando" },
      data,
    });

    if (count === 0) {
      return Response.json(
        { error: "La sesión no está en procesamiento; callback ignorado" },
        { status: 409 },
      );
    }

    const intentoPipeline = parsed.data.datosEstructurados?._pipeline?.intento;
    await registrarAuditoria({
      organizationId: sesion.organizationId,
      actorTipo: "worker",
      actorId: null,
      accion: "sesion.callback",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: {
        estadoResultado: parsed.data.estado,
        promptVersion: parsed.data.promptVersion ?? null,
        modeloASR: parsed.data.modeloASR ?? null,
        modeloLLM: parsed.data.modeloLLM ?? null,
        rolesOrigen:
          parsed.data.datosEstructurados?.speechAnalytics?.rolesOrigen ?? null,
        ...(typeof intentoPipeline === "number" ||
        typeof intentoPipeline === "string"
          ? { intento: intentoPipeline }
          : {}),
        nivelRiesgo:
          parsed.data.datosEstructurados?.riesgoDetectado?.nivel ?? null,
        huboError: esError,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
