// Única fuente de verdad de las listas cerradas del turno: duraciones,
// modalidades, estados, métodos de pago y frecuencias de una serie.
//
// De acá derivan los tipos (`Duracion`, `Modalidad`, …), los schemas Zod que
// validan lo que entra por la API y las opciones que dibujan los
// formularios. Antes cada uno tenía su copia: el array `[30, 45, 50, 60, 90]`
// estaba escrito en cuatro archivos y el tipo unión en un quinto.
//
// Lo que NO puede derivar de acá y hay que mantener igual a mano:
//   - los enums de Postgres `modalidad`, `metodo_pago`, `estado_turno`,
//     `estado_pago` y `frecuencia_serie` (prisma/schema.prisma);
//   - el CHECK de `turnos.duracion`: Int y no enum porque se suma a la
//     fecha. Nació en prisma/migrations/0_init (bloque "A MANO") y hoy lo
//     define 20260923120000_turnos_duracion_120. Cambiar la lista es una
//     migración nueva que lo reemplaza, nunca editar una ya aplicada.
//     solapamiento-turnos.test.ts lo compara con la base real.
// src/lib/__tests__/constantes-turno.test.ts compara estos arrays con los
// enums que genera Prisma, así que una divergencia falla en CI.
//
// Módulo puro (solo zod): lo importan componentes cliente y servidor.

import { z } from "zod";

export const DURACIONES = [30, 45, 50, 60, 90, 120] as const;
export type Duracion = (typeof DURACIONES)[number];
/** La que propone el formulario y el default de la columna. */
export const DURACION_DEFAULT: Duracion = 50;

export const MODALIDADES = ["presencial", "online"] as const;
export type Modalidad = (typeof MODALIDADES)[number];
export const MODALIDAD_DEFAULT: Modalidad = "presencial";

export const ESTADOS_TURNO = [
  "programado",
  "realizado",
  "cancelado",
  "ausente",
] as const;
export type EstadoTurno = (typeof ESTADOS_TURNO)[number];

export const ESTADOS_PAGO = ["pendiente", "pagado"] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

/** El orden es el que se ofrece en los formularios de cobro. Las etiquetas
 *  (lo que ve la usuaria) viven en glosario.ts, METODO_PAGO_LABEL. */
export const METODOS_PAGO = [
  "efectivo",
  "transferencia",
  "mercadopago",
  "debito",
  "credito",
  "otro",
] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Frecuencias de una serie de turnos (tabla series_turno). */
export const FRECUENCIAS_SERIE = ["semanal", "quincenal"] as const;
export type FrecuenciaSerie = (typeof FRECUENCIAS_SERIE)[number];

/** Lo que elige el formulario: "unico" no crea serie. */
export const FRECUENCIAS_TURNO = ["unico", ...FRECUENCIAS_SERIE] as const;
export type FrecuenciaTurno = (typeof FRECUENCIAS_TURNO)[number];

export function esDuracion(valor: unknown): valor is Duracion {
  return (DURACIONES as readonly unknown[]).includes(valor);
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas Zod, derivados de los arrays de arriba. Un solo lugar los declara.
// ────────────────────────────────────────────────────────────────────────────

export const duracionSchema = z.literal(DURACIONES);
export const modalidadSchema = z.enum(MODALIDADES);
export const estadoTurnoSchema = z.enum(ESTADOS_TURNO);
export const metodoPagoSchema = z.enum(METODOS_PAGO);
export const frecuenciaSerieSchema = z.enum(FRECUENCIAS_SERIE);
export const frecuenciaTurnoSchema = z.enum(FRECUENCIAS_TURNO);
