import { z } from "zod";

import { excedeMaximoPalabras, TERMINO_MUY_LARGO } from "@/lib/hot-words";
import { normalizePhone } from "@/lib/phone";

// Las listas cerradas del turno se declaran una sola vez en
// src/lib/constantes-turno.ts; acá solo se re-exportan para las rutas.
export {
  duracionSchema,
  frecuenciaSerieSchema,
  metodoPagoSchema,
  modalidadSchema,
  estadoTurnoSchema as turnoEstadoSchema,
} from "@/lib/constantes-turno";

export const isoDateTimeSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Fecha inválida",
);

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
    categoria: z.string().trim().max(50).nullish(),
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
