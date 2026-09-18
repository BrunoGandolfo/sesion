import { z } from "zod";
export { editarHiloSchema, aceptarHiloSchema, resolverHiloSchema, regenerarHiloSchema } from "@/lib/hilo/contenido";

import {
  duracionSchema,
  estadoTurnoSchema,
  frecuenciaTurnoSchema,
  modalidadSchema,
} from "@/lib/constantes-turno";
import { excedeMaximoPalabras, TERMINO_MUY_LARGO } from "@/lib/hot-words";
import { normalizePhone } from "@/lib/phone";
import { RECORDATORIO_MODOS } from "@/lib/recordatorios-programacion";
import { pausasGrabacionSchema } from "@/lib/sesion-clinica/schema";

// Las listas cerradas del turno se declaran una sola vez en
// src/lib/constantes-turno.ts; acá solo se re-exportan para las rutas.
export {
  duracionSchema,
  frecuenciaSerieSchema,
  frecuenciaTurnoSchema,
  metodoPagoSchema,
  modalidadSchema,
  estadoTurnoSchema as turnoEstadoSchema,
} from "@/lib/constantes-turno";

export const isoDateTimeSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Fecha inválida",
);

// ────────────────────────────────────────────────────────────────────────────
// Turno — el body de POST /api/turnos y de PATCH /api/turnos/[id]. Viven acá
// y no en las rutas porque un route.ts solo puede exportar sus handlers, y
// los tests los necesitan.
// ────────────────────────────────────────────────────────────────────────────

/** Los ids los genera la app como uuid (docs/esquema.md §2, punto 12). */
export const turnoCreateSchema = z.object({
  pacienteId: z.string().uuid("Paciente inválido"),
  fecha: isoDateTimeSchema,
  duracion: duracionSchema,
  modalidad: modalidadSchema,
  notas: z.string().trim().nullable().optional(),
  /** "unico" agenda uno solo; semanal/quincenal crean una serie. Opcional
   *  para quien agenda uno sin pensar en series (la pantalla de grabar). */
  frecuencia: frecuenciaTurnoSchema.default("unico"),
});

export const turnoUpdateSchema = z.object({
  fecha: isoDateTimeSchema.optional(),
  duracion: duracionSchema.optional(),
  modalidad: modalidadSchema.optional(),
  notas: z.string().trim().nullable().optional(),
  estado: estadoTurnoSchema.optional(),
});

export function toBooleanParam(value: string | null, fallback: boolean) {
  if (value === null || value === "") return fallback;
  return value === "true";
}

// ────────────────────────────────────────────────────────────────────────────
// Paciente — único esquema para POST /api/pacientes y PATCH /api/pacientes/[id].
// Antes cada ruta tenía su copia y divergían (teléfono mín 8 vs mín 1, tarifa
// positiva vs entera ≥ 0).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Teléfono: se valida y normaliza a E.164 con la única regla del dominio
 * (src/lib/phone.ts: +CC… o 0… uruguayo). El mensaje de error es el de
 * normalizePhone, el mismo que antes devolvían las rutas por ApiError 400.
 */
const telefonoSchema = z
  .string()
  .trim()
  .min(1, "Falta el teléfono")
  .transform((valor, ctx) => {
    try {
      return normalizePhone(valor);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          err instanceof Error
            ? err.message
            : "El teléfono no tiene un formato válido. Usá el formato +598 99 123 456",
      });
      return z.NEVER;
    }
  });

/** Tarifa en UYU sin centavos: entera y mayor a cero (una sesión no es gratis). */
const tarifaSchema = z
  .number()
  .int("La tarifa debe ser un número entero")
  .positive("La tarifa debe ser mayor a cero");

export const pacienteCreateSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  apellido: z.string().trim().min(1, "Falta el apellido"),
  telefono: telefonoSchema,
  tarifa: tarifaSchema,
  notas: z.string().trim().nullable().optional(),
});

// `activo` solo existe en la edición (alta y baja lógica).
export const pacienteUpdateSchema = pacienteCreateSchema.partial().extend({
  activo: z.boolean().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Vocabulario clínico (hot words) — la validación del POST y del GET.
//
// Vivía dentro de src/app/api/hot-words/route.ts. Se mudó acá por dos
// razones: es el mismo lugar donde ya viven las reglas de paciente y turno, y
// un route.ts de Next solo puede exportar sus handlers, así que la regla no
// se podía testear sin levantar la ruta entera.
//
// El límite de seis palabras por término es de AssemblyAI y sale de
// @/lib/hot-words, que es lo que también lee el formulario.
// ────────────────────────────────────────────────────────────────────────────

const hotWordScopeSchema = z.enum(["global", "profesional", "paciente"]);

/** Las categorías del vocabulario. Espejo del enum `categoria_hot_word` de
 *  Postgres (prisma/schema.prisma): src/lib/__tests__/hot-words.test.ts
 *  compara las dos listas, así que una divergencia falla en CI. */
export const CATEGORIAS_HOT_WORD = [
  "termino_clinico",
  "modismo_rioplatense",
  "nombre_propio",
  "otro",
] as const;
export const categoriaHotWordSchema = z.enum(CATEGORIAS_HOT_WORD);

/** PATCH /api/hot-words/[id]: activar/desactivar o recategorizar. */
export const hotWordUpdateSchema = z
  .object({
    activo: z.boolean().optional(),
    categoria: categoriaHotWordSchema.nullable().optional(),
  })
  .refine((v) => v.activo !== undefined || v.categoria !== undefined, {
    message: "Nada para actualizar",
  });

const terminoSchema = z
  .string()
  .trim()
  .min(1, "Falta el término")
  .max(200, "El término no puede pasar de 200 caracteres")
  .refine((valor) => !excedeMaximoPalabras(valor), TERMINO_MUY_LARGO);

/** Un término suelto. `pacienteId` va si y solo si el scope es "paciente". */
export const hotWordItemSchema = z
  .object({
    termino: terminoSchema,
    scope: hotWordScopeSchema,
    // Antes era texto libre; en la base es un enum, así que el 400 sale acá.
    categoria: categoriaHotWordSchema.nullish(),
    pacienteId: z.string().uuid().nullish(),
  })
  .refine((v) => (v.scope === "paciente" ? !!v.pacienteId : !v.pacienteId), {
    message: "pacienteId es obligatorio solo cuando scope === 'paciente'",
    path: ["pacienteId"],
  });

/** Carga masiva: la lista que manda el textarea de "Carga masiva". */
export const hotWordsBulkSchema = z.object({
  hotWords: z.array(hotWordItemSchema).min(1),
});

export const hotWordsQuerySchema = z.object({
  scope: hotWordScopeSchema,
  pacienteId: z.string().uuid().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Configuración — el body de PATCH /api/config.
//
// `horasAnticipacion` NO está, a propósito: dejó de decidir nada cuando el
// recordatorio pasó a guardarse como un MOMENTO (`recordatorioModo`). Un
// contrato que contesta que sí a algo que no hace es una mentira, no una
// compatibilidad. Como zod ignora las claves que el objeto no declara,
// mandarlo no rompe: se descarta en silencio y el resto se guarda igual.
// ────────────────────────────────────────────────────────────────────────────

export const configUpdateSchema = z.object({
  nombreProfesional: z.string().trim().min(1, "Falta el nombre").optional(),
  direccion: z.string().trim().optional(),
  whatsappOrigen: z.string().trim().optional(),
  tarifaDefault: z
    .number()
    .int()
    .min(0, "La tarifa no puede ser negativa")
    .optional(),
  /** Cuándo sale el recordatorio. Ver src/lib/recordatorios-programacion.ts. */
  recordatorioModo: z.enum(RECORDATORIO_MODOS).optional(),
  templateRecordatorio: z
    .string()
    .trim()
    .min(1, "Falta el template")
    .optional(),
  orientacionTeorica: z.enum(["cbt_mi", "gestalt"]).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Grabación y subida del audio (rutas de sesión clínica)
// ────────────────────────────────────────────────────────────────────────────

export const sesionClinicaCrearSchema = z.object({ turnoId: z.uuid() }).strict();

// Sin tope de 120 MB (era el límite del buffer en memoria de la función).
// Queda solo una cota de sanidad: 2 GiB, muy por encima de una sesión de
// 90 min en Opus (~40-60 MB).
const MAX_TAMANO_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;

/** POST [id]/upload-url */
export const uploadUrlSchema = z.object({
  iv: z.string().trim().min(1, "Falta el IV de cifrado"),
  tamanoBytes: z
    .number()
    .int("El tamaño debe ser un entero")
    .positive("El tamaño debe ser mayor a cero")
    .max(MAX_TAMANO_AUDIO_BYTES, "El audio supera el tamaño máximo admitido"),
  mime: z.string().trim().min(1).max(100).default("application/octet-stream"),
});

/** POST [id]/upload-confirmar */
export const uploadConfirmarSchema = z.object({
  key: z.string().trim().min(1, "Falta la key del audio"),
  duracionAudioSeg: z
    .number()
    .int("La duración debe ser un número entero")
    .nonnegative("La duración no puede ser negativa"),
  pausas: pausasGrabacionSchema.optional(),
});
