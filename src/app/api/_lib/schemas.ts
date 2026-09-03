import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

export const duracionSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(50),
  z.literal(60),
  z.literal(90),
]);

export const modalidadSchema = z.enum(["presencial", "online"]);
export const turnoEstadoSchema = z.enum([
  "programado",
  "realizado",
  "cancelado",
  "ausente",
]);
export const metodoPagoSchema = z.enum([
  "efectivo",
  "transferencia",
  "mercadopago",
  "debito",
  "credito",
  "otro",
]);

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

/** Email opcional: "" se trata como null (el form manda string vacío). */
export const emailOpcionalSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().email("El email no tiene un formato válido").nullable().optional(),
);

/**
 * Teléfono: se valida y normaliza a E.164 con la única regla del dominio
 * (src/lib/phone.ts: +CC… o 0… uruguayo). El mensaje de error es el de
 * normalizePhone, el mismo que antes devolvían las rutas por ApiError 400.
 */
export const telefonoSchema = z
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
export const tarifaSchema = z
  .number()
  .int("La tarifa debe ser un número entero")
  .positive("La tarifa debe ser mayor a cero");

export const pacienteCreateSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre"),
  apellido: z.string().trim().min(1, "Falta el apellido"),
  telefono: telefonoSchema,
  email: emailOpcionalSchema,
  tarifa: tarifaSchema,
  notas: z.string().trim().nullable().optional(),
});
export type PacienteCreateInput = z.infer<typeof pacienteCreateSchema>;

// `activo` solo existe en la edición (alta y baja lógica).
export const pacienteUpdateSchema = pacienteCreateSchema.partial().extend({
  activo: z.boolean().optional(),
});
export type PacienteUpdateInput = z.infer<typeof pacienteUpdateSchema>;
