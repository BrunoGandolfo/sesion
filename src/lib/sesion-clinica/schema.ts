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

// ────────────────────────────────────────────────────────────────────────────
// Enumeraciones (una sola vez)
// ────────────────────────────────────────────────────────────────────────────

export const estadoSesionSchema = z.enum([
  "pendiente",
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobado",
  "error",
]);
export type EstadoSesion = z.infer<typeof estadoSesionSchema>;

export const tipoIntervencionSchema = z.enum([
  "reformulacion",
  "senalamiento",
  "confrontacion",
  "interpretacion",
  "pregunta_circular",
  "validacion",
  "silencio_terapeutico",
  "otra",
]);
export type TipoIntervencion = z.infer<typeof tipoIntervencionSchema>;

export const flagRiesgoSchema = z.enum([
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
]);
export type FlagRiesgo = z.infer<typeof flagRiesgoSchema>;

export const nivelRiesgoSchema = z.enum(["ninguno", "bajo", "moderado", "alto"]);
export type NivelRiesgo = z.infer<typeof nivelRiesgoSchema>;

export const alianzaTerapeuticaSchema = z.enum([
  "fragil",
  "inestable",
  "estable",
  "fuerte",
]);
export type AlianzaTerapeutica = z.infer<typeof alianzaTerapeuticaSchema>;

export const confianzaModeloSchema = z.enum(["alta", "media", "baja"]);
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

const speechAnalyticsSchema = z.object({
  ratioHablaTerapeuta: z.number(),
  ratioHablaPaciente: z.number(),
  cantidadSilencios: z.number(),
  duracionPromedioSilenciosSeg: z.number(),
  tiempoTotalHablaSeg: z.number(),
  speakersDetectados: z.number().int().optional(),
  rolesOrigen: rolesOrigenSchema.optional(),
});

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
  // Unión discriminada por orientación teórica; su shape se valida al leer
  // con normalizarFeedback (src/types/domain.ts). Acá solo se preserva.
  feedbackTerapeuta: z.unknown().optional(),
  confianzaModelo: confianzaModeloSchema.optional(),
  resumenSesion: z.string().optional(),
  estadoEmocionalObservado: z.string().optional(),
  duracionRealMin: z.number().optional(),
  speechAnalytics: speechAnalyticsSchema.optional(),
  observacionIA: z.string().optional(),
  // Metadata de trazabilidad del pipeline; opaca para la app.
  _pipeline: z.record(z.string(), z.unknown()).optional(),
});
export type DatosEstructurados = z.infer<typeof datosEstructuradosSchema>;

/**
 * Parseo tolerante: acepta el objeto ya deserializado (extensión Prisma) o
 * el string JSON crudo (filas legacy). Devuelve null si no valida. Nunca
 * lanza. Las claves desconocidas (incluida `_audioCifradoTemporal`) se
 * descartan por el comportamiento por defecto de z.object.
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

export const pausaGrabacionSchema = z.object({
  inicio: fechaIso,
  fin: fechaIso,
});
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

// La extensión de cifrado reconstruye notaSoapOriginal con `?? null` por
// campo (src/lib/prisma-encryption.ts), por eso acá cada sección es nullable.
export const notaSoapOriginalSchema = z.object({
  subjetivo: z.string().nullable(),
  objetivo: z.string().nullable(),
  analisis: z.string().nullable(),
  plan: z.string().nullable(),
});
export type NotaSoapOriginal = z.infer<typeof notaSoapOriginalSchema>;

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

export const sesionClinicaResponseSchema = z.object({
  id: z.string(),
  turnoId: z.string(),
  estado: estadoSesionSchema,
  duracionAudioSeg: z.number().int().nullable(),
  audioR2Key: z.string().nullable(),
  audioBorradoEn: fechaIso.nullable(),
  // Opcional: solo los selects que la piden la traen; null si la grabación
  // no reportó pausas.
  pausas: pausasGrabacionSchema.nullable().optional(),
  notaSubjetivo: z.string().nullable(),
  notaObjetivo: z.string().nullable(),
  notaAnalisis: z.string().nullable(),
  notaPlan: z.string().nullable(),
  notaSoapOriginal: notaSoapOriginalSchema.nullable(),
  datosEstructurados: datosEstructuradosSchema.nullable(),
  modeloASR: z.string().nullable(),
  modeloLLM: z.string().nullable(),
  promptVersion: z.string().nullable(),
  hablanteTerapeuta: z.string().nullable(),
  procesadoEn: fechaIso.nullable(),
  aprobadoEn: fechaIso.nullable(),
  error: z.string().nullable(),
  intentos: z.number().int(),
  createdAt: fechaIso,
  updatedAt: fechaIso,
  // Solo los selects de GET /[id] y GET ?turnoId lo incluyen.
  turno: turnoMinimoSchema.optional(),
});
export type SesionClinicaResponse = z.infer<typeof sesionClinicaResponseSchema>;
