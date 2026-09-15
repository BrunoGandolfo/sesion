// Única definición Zod del contrato de sesión clínica que viaja entre el
// worker, la API y la UI. Unifica tres copias previas:
//   - src/types/domain.ts (tipos TS de DatosEstructurados y SesionClinicaResponse)
//   - src/app/api/sesion-clinica/callback/route.ts (Zod del payload del worker)
//   - src/lib/sesion-clinica-utils.ts (parser estricto parseDatosEstructurados)
// Criterio: la forma que acepta el callback refleja los datos reales que
// llegan del worker, así que lo opcional ahí queda opcional acá. Donde las
// copias divergen se toma la más permisiva.
//
// Este módulo es solo contrato: sin acceso a datos, sin reglas de negocio.

import { z } from "zod";

import enumsClinicos from "../../../processor/contrato/enums-clinicos.json";

// ────────────────────────────────────────────────────────────────────────────
// Enumeraciones (una sola vez)
// ────────────────────────────────────────────────────────────────────────────

// Máquina de estados de la sesión (prisma/schema.prisma, enum estado_sesion).
// `aprobada` es el único terminal. La tabla de transiciones vive en
// src/lib/sesion-clinica/estados.ts; acá sólo la lista cerrada.
export const estadoSesionSchema = z.enum([
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobada",
  "fallida",
]);
export type EstadoSesion = z.infer<typeof estadoSesionSchema>;

/** Dónde está el audio hoy (enum estado_audio). */
export const estadoAudioSchema = z.enum(["sin_audio", "en_r2", "borrado"]);
export type EstadoAudio = z.infer<typeof estadoAudioSchema>;

/** Estado propio de "Para vos" (enum estado_feedback). */
export const estadoFeedbackSchema = z.enum([
  "no_pedido",
  "pendiente",
  "listo",
  "fallido",
]);
export type EstadoFeedback = z.infer<typeof estadoFeedbackSchema>;

// Los enums que también lee el worker salen de processor/contrato/
// enums-clinicos.json, la única copia (AGENTS.md, regla 3): un valor nuevo se
// agrega ahí y los dos lados lo ven. El costo es que TypeScript no puede
// inferir literales de un JSON, así que estos tipos son `string` y no la
// unión de valores; la validación real la hace Zod en tiempo de ejecución con
// la lista del archivo.
export const ENUMS_CLINICOS = enumsClinicos;

function enumDelContrato(valores: readonly string[]) {
  const [primero, ...resto] = valores;
  if (primero === undefined) {
    throw new Error("processor/contrato/enums-clinicos.json: enum vacío");
  }
  return z.enum([primero, ...resto]);
}

export const tipoIntervencionSchema = enumDelContrato(ENUMS_CLINICOS.tipoIntervencion);
export type TipoIntervencion = z.infer<typeof tipoIntervencionSchema>;

export const flagRiesgoSchema = enumDelContrato(ENUMS_CLINICOS.flagRiesgo);
/** Las flags son además las claves del objeto `flagsRiesgo` (abajo), así que
 *  el tipo sale de ahí y sigue siendo la unión literal; el test
 *  enums-clinicos.test.ts verifica que esas claves son las del contrato. */
export type FlagRiesgo = Exclude<keyof z.infer<typeof flagsRiesgoSchema>, "detalle">;

export const nivelRiesgoSchema = enumDelContrato(ENUMS_CLINICOS.nivelRiesgo);
export type NivelRiesgo = z.infer<typeof nivelRiesgoSchema>;

export const alianzaTerapeuticaSchema = enumDelContrato(ENUMS_CLINICOS.alianzaTerapeutica);
export type AlianzaTerapeutica = z.infer<typeof alianzaTerapeuticaSchema>;

export const confianzaModeloSchema = enumDelContrato(ENUMS_CLINICOS.confianzaModelo);
export type ConfianzaModelo = z.infer<typeof confianzaModeloSchema>;

export const rolesOrigenSchema = z.enum(["asr_role", "posicional"]);
export type RolesOrigen = z.infer<typeof rolesOrigenSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Nota SOAP
// ────────────────────────────────────────────────────────────────────────────

export const notaSoapSchema = z.object({
  subjetivo: z.string(),
  objetivo: z.string(),
  analisis: z.string(),
  plan: z.string(),
});
export type NotaSoap = z.infer<typeof notaSoapSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Datos estructurados (salida del LLM)
// ────────────────────────────────────────────────────────────────────────────

const intervencionSchema = z.object({
  tipo: tipoIntervencionSchema,
  descripcion: z.string(),
  // Opcional (callback). El parser estricto exigía "MM:SS"; se toma lo
  // permisivo porque el worker no siempre lo manda.
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

const evidenciaRiesgoSchema = z.object({
  timestamp: z.string(),
  quote: z.string(),
});

const riesgoDetectadoSchema = z.object({
  nivel: nivelRiesgoSchema,
  indicadores: z.array(z.string()),
  evidencia: z.array(evidenciaRiesgoSchema),
  notaParaTerapeuta: z.string().nullable(),
});

export const speechAnalyticsSchema = z.object({
  ratioHablaTerapeuta: z.number(),
  ratioHablaPaciente: z.number(),
  cantidadSilencios: z.number(),
  duracionPromedioSilenciosSeg: z.number(),
  tiempoTotalHablaSeg: z.number(),
  speakersDetectados: z.number().int().optional(),
  rolesOrigen: rolesOrigenSchema.optional(),
});
export type SpeechAnalytics = z.infer<typeof speechAnalyticsSchema>;

export const datosEstructuradosSchema = z.object({
  temas: z.array(z.string()).optional(),
  emocionesPaciente: z.array(z.string()).optional(),
  intensidadEmocional: z.number().min(1).max(10).optional(),
  alianzaTerapeutica: alianzaTerapeuticaSchema.optional(),
  intervenciones: z.array(intervencionSchema).optional(),
  compromisos: z.array(z.string()).optional(),
  progresoPercibido: z.string().optional(),
  materialRecurrente: z.array(z.string()).optional(),
  materialNuevo: z.array(z.string()).optional(),
  focoProximaSesion: z.string().optional(),
  flagsRiesgo: flagsRiesgoSchema.optional(),
  // Best-effort (contrato de riesgo clínico): un shape inválido se descarta
  // en vez de invalidar todo el objeto. Los lectores normalizan a "ninguno".
  riesgoDetectado: riesgoDetectadoSchema.optional().catch(undefined),
  // Menciones léxicas de riesgo (las produce el worker, Área 4; diseño 04
  // §2.9: { version, coincidencias: [{ termino, timestamp, quote }] }). Acá
  // sólo la forma mínima que lee `aprobar`: si hay coincidencias y el modelo
  // no graduó riesgo, la aprobación exige `confirmoMenciones`.
  riesgoLexico: z
    .object({ coincidencias: z.array(z.unknown()) })
    .passthrough()
    .optional()
    .catch(undefined),
  confianzaModelo: confianzaModeloSchema.optional(),
  resumenSesion: z.string().optional(),
  estadoEmocionalObservado: z.string().optional(),
  duracionRealMin: z.number().optional(),
  speechAnalytics: speechAnalyticsSchema.optional(),
  observacionIA: z.string().optional(),
});
export type DatosEstructurados = z.infer<typeof datosEstructuradosSchema>;

/**
 * Parseo tolerante: acepta el objeto ya deserializado o el string JSON.
 * Devuelve null si no valida. Nunca lanza. Las claves desconocidas se
 * descartan por el comportamiento por defecto de z.object. El feedback de
 * "Para vos" NO viaja acá: tiene columna y estado propios (`feedback`,
 * `feedbackEstado`).
 */
export function parseDatosEstructurados(raw: unknown): DatosEstructurados | null {
  if (raw == null) return null;
  let candidato: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidato = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const resultado = datosEstructuradosSchema.safeParse(candidato);
  return resultado.success ? resultado.data : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Respuesta de sesión clínica hacia la UI
// ────────────────────────────────────────────────────────────────────────────

const fechaIso = z.string().datetime();

// ────────────────────────────────────────────────────────────────────────────
// Pausas de la grabación
//
// Los tramos en que la profesional pausó mientras grababa, tal como los
// reporta el navegador al confirmar la subida. No son PHI —son marcas de
// tiempo del dispositivo— y por eso viven en una columna Json sin cifrar.
// Sirven para leer la duración real de la sesión: 50 minutos de audio con
// tres pausas no son 50 minutos de trabajo.
// ────────────────────────────────────────────────────────────────────────────

const pausaHistoricaSchema = z.object({
  inicio: fechaIso,
  fin: fechaIso,
});
/** Marcas de audio medidas con reloj monotónico; no son fechas de pared. */
export const pausaMedidaSchema = z.object({
  inicio: z.number().finite().nonnegative(),
  fin: z.number().finite().nonnegative().nullable(),
  siguienteIndice: z.int().nonnegative(),
  motivo: z.enum(["manual", "interrupcion", "limite"]),
}).strict();
export type PausaMedida = z.infer<typeof pausaMedidaSchema>;
// La lectura conserva las pausas ya guardadas sin reescribir sus filas.
export const pausaGrabacionSchema = z.union([pausaHistoricaSchema, pausaMedidaSchema]);
export type PausaGrabacion = z.infer<typeof pausaGrabacionSchema>;

export const pausasGrabacionSchema = z.array(pausaGrabacionSchema);

/**
 * Parseo tolerante de la columna `pausas`: acepta el array ya deserializado
 * o el string JSON; devuelve null si está ausente o no valida. Nunca lanza:
 * una pausa mal escrita no puede impedir leer la nota.
 */
export function parsePausas(raw: unknown): PausaGrabacion[] | null {
  if (raw == null) return null;
  let candidato: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidato = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const resultado = pausasGrabacionSchema.safeParse(candidato);
  return resultado.success ? resultado.data : null;
}

const turnoMinimoSchema = z.object({
  id: z.string(),
  fecha: fechaIso,
  paciente: z.object({
    id: z.string(),
    nombre: z.string(),
    apellido: z.string(),
    // GET /api/sesion-clinica?turnoId no lo trae; GET /[id] sí.
    telefono: z.string().optional(),
  }),
});

/**
 * La sesión tal como la ve la UI. Sin transcripción (tiene endpoint propio,
 * GET /api/sesion-clinica/[id]/transcripcion, con auditoría de cada lectura),
 * sin clave de audio y sin key de R2 (no existe como columna: se calcula).
 *
 * `notaIa` es lo que la IA generó en la generación vigente; `notaFinal` lo
 * que ella aprobó (null hasta aprobar). En revisión la pantalla edita a
 * partir de `notaIa`; después de aprobar muestra `notaFinal`.
 */
export const sesionClinicaResponseSchema = z.object({
  id: z.string(),
  turnoId: z.string(),
  estado: estadoSesionSchema,
  audioEstado: estadoAudioSchema,
  audioBorradoEn: fechaIso.nullable(),
  duracionAudioSeg: z.number().int().nullable(),
  // Opcional: solo los selects que la piden la traen; null si la grabación
  // no reportó pausas.
  pausas: pausasGrabacionSchema.nullable().optional(),
  /** Identidad del reclamo del worker. Sube en cada claim, nunca baja. */
  intento: z.number().int(),
  /** Cuántas veces el worker entregó una nota. */
  generacion: z.number().int(),
  falloCodigo: z.string().nullable(),
  falloDetalle: z.string().nullable(),
  /** true si el checkpoint de transcripción ya se escribió. */
  transcripcionDisponible: z.boolean(),
  notaIa: notaSoapSchema.nullable(),
  notaFinal: notaSoapSchema.nullable(),
  notasEdicion: z.string().nullable(),
  datos: datosEstructuradosSchema.nullable(),
  feedbackEstado: estadoFeedbackSchema,
  // Su forma la valida quien lo dibuja (normalizarFeedback / hayParaVos).
  feedback: z.unknown(),
  feedbackError: z.string().nullable(),
  modeloAsr: z.string().nullable(),
  modeloLlm: z.string().nullable(),
  promptVersion: z.string().nullable(),
  procesadaEn: fechaIso.nullable(),
  aprobadaEn: fechaIso.nullable(),
  creadaEn: fechaIso,
  actualizadaEn: fechaIso,
  // Solo los selects de GET /[id] y GET ?turnoId lo incluyen.
  turno: turnoMinimoSchema.optional(),
});
export type SesionClinicaResponse = z.infer<typeof sesionClinicaResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Contrato con el worker (rutas M2M de /api/sesion-clinica/[id]/*)
//
// Todo pedido que toca una sesión lleva `intento`: la app lo compara con el
// vigente y responde 409 si no coincide. Qué es "transitorio" y qué
// "definitivo" lo decide el worker; la app sólo aplica su política.
// ────────────────────────────────────────────────────────────────────────────

/** Consumo de una corrida: lo suma el reporte mensual. Forma abierta. */
export const usoSchema = z
  .object({
    asrSegundos: z.number().nonnegative().optional(),
    llamadas: z
      .array(
        z
          .object({
            nombre: z.string(),
            entrada: z.number().int().nonnegative(),
            salida: z.number().int().nonnegative(),
            cacheLectura: z.number().int().nonnegative().optional(),
            cacheEscritura: z.number().int().nonnegative().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type Uso = z.infer<typeof usoSchema>;

const intentoSchema = z.number().int().positive();

/** POST [id]/lease */
export const leaseSchema = z.object({
  pausasAudio: z.array(pausaMedidaSchema).max(3600).optional(),
  intento: intentoSchema,
  /** En qué paso está (asr, nota…): sólo para la señal de vida. */
  paso: z.string().max(40).optional(),
});

/** POST [id]/asr: el transcript existe en AssemblyAI; hay que borrarlo. */
export const registrarAsrSchema = z.object({
  intento: intentoSchema,
  transcriptId: z.string().min(1).max(120),
});

/** POST [id]/transcripcion: checkpoint tras el ASR. Idempotente. */
export const registrarTranscripcionSchema = z.object({
  intento: intentoSchema,
  transcripcion: z.string().min(1),
  speechAnalytics: speechAnalyticsSchema.optional(),
  modeloAsr: z.string().max(120),
  duracionSeg: z.number().int().nonnegative().optional(),
  asrTranscriptId: z.string().max(120).optional(),
});

/** POST [id]/resultado, rama "nota": sin feedback (lo pide otro trabajo). */
export const resultadoNotaSchema = z.object({
  intento: intentoSchema,
  resultado: z.literal("nota"),
  nota: notaSoapSchema,
  datos: datosEstructuradosSchema,
  modeloLlm: z.string().max(120),
  promptVersion: z.string().max(200),
  uso: usoSchema.optional(),
});

/** POST [id]/resultado, rama "fallo". */
export const resultadoFalloSchema = z.object({
  intento: intentoSchema,
  resultado: z.literal("fallo"),
  codigo: z.string().min(1).max(60),
  definitivo: z.boolean(),
  paso: z.string().max(40).optional(),
  detalle: z.string().max(500).optional(),
  uso: usoSchema.optional(),
});

export const resultadoSesionSchema = z.discriminatedUnion("resultado", [
  resultadoNotaSchema,
  resultadoFalloSchema,
]);
export type ResultadoSesion = z.infer<typeof resultadoSesionSchema>;

/** POST /api/trabajos/[id]/resultado */
export const resultadoTrabajoSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** generar_feedback: el reporte "Para vos". */
    feedback: z.unknown().optional(),
    /** integrar_contexto (Área 4): la propuesta para el hilo. */
    propuesta: z.unknown().optional(),
    promptVersion: z.string().max(200).optional(),
    modeloLlm: z.string().max(120).optional(),
    uso: usoSchema.optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().max(500),
    uso: usoSchema.optional(),
  }),
]);
export type ResultadoTrabajo = z.infer<typeof resultadoTrabajoSchema>;
