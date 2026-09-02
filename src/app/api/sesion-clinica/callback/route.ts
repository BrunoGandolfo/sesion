// Endpoint M2M: el worker Python (processor/) entrega acá el resultado del
// procesamiento. Se autentica con PROCESSING_SECRET (Bearer token); está
// excluido del matcher de auth en src/middleware.ts.

import { z } from "zod";
import { db } from "@/lib/db";

import { registrarAuditoria } from "../../_lib/auditoria";
import { errorResponse, validationError } from "../../_lib/responses";
import { extraerClaveTemporal } from "../../_lib/sesion-clinica";

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
  speakersDetectados: z.number().int().optional(),
  // Origen de los roles terapeuta/paciente: etiquetas del ASR o heurística
  // posicional (fallback del worker cuando la diarización colapsa).
  rolesOrigen: z.enum(["asr_role", "posicional"]).optional(),
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
  // Metadata de trazabilidad del pipeline (versiones de prompts, tiempos,
  // etc.). Opaca para la app: se persiste tal cual dentro de
  // datosEstructurados y no se valida su shape.
  _pipeline: z.record(z.string(), z.unknown()).optional(),
});

const callbackSchema = z.object({
  sesionClinicaId: z.string(),
  estado: z.enum(["revision", "error"]),
  transcripcion: z.string().optional(),
  nota: notaSchema.optional(),
  datosEstructurados: datosEstructuradosSchema.optional(),
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
    // La clave (upload la guarda en datosEstructurados._audioCifradoTemporal;
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
    // antes de cualquier intervención humana. La extensión Prisma la cifra
    // (campo lógico, sin columna legacy: por eso el cast — el tipo generado
    // no la conoce).
    const notaOriginalPrevia = (sesion as { notaSoapOriginal?: unknown })
      .notaSoapOriginal;
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

    const pipeline = parsed.data.datosEstructurados?._pipeline;
    const intentoPipeline = pipeline?.intento;
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
