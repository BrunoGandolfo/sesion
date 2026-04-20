import { z } from "zod";

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
