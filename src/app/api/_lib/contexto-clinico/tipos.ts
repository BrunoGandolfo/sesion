// Contrato del Golden Thread (PacienteContextoClinico): tipos del payload que
// devuelve GET /api/pacientes/[id]/contexto-clinico y schema Zod del PATCH.
// Única definición; antes vivían en la ruta.

import { z } from "zod";

import type { db } from "@/lib/db";

export type ClientePrisma = typeof db;

// ────────────────────────────────────────────────────────────────────────────
// Elementos del contexto (schemas Zod → tipos)
// ────────────────────────────────────────────────────────────────────────────

export const estadoObjetivoSchema = z.enum(["activo", "cerrado", "pausado"]);
export type EstadoObjetivo = z.infer<typeof estadoObjetivoSchema>;

export const objetivoSchema = z.object({
  id: z.string().min(1),
  descripcion: z.string().min(1),
  estado: estadoObjetivoSchema,
  fechaInicio: z.string().min(1),
  fechaCierre: z.string().nullable().optional(),
});
export type Objetivo = z.infer<typeof objetivoSchema>;

export const eficaciaSchema = z.enum(["alta", "media", "baja"]);
export type Eficacia = z.infer<typeof eficaciaSchema>;

export const intervencionSchema = z.object({
  tecnica: z.string().min(1),
  eficaciaPercibida: eficaciaSchema,
  sesiones: z.array(z.number().int().nonnegative()),
});
export type Intervencion = z.infer<typeof intervencionSchema>;

export const temaSchema = z.object({
  tema: z.string().min(1),
  conteo: z.number().int().nonnegative(),
});
export type Tema = z.infer<typeof temaSchema>;

export const riesgoHistoricoSchema = z.object({
  sesionId: z.string().min(1),
  fecha: z.string().min(1),
  flag: z.string().min(1),
  detalle: z.string().optional(),
});
export type RiesgoHistorico = z.infer<typeof riesgoHistoricoSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Body del PATCH: todos opcionales, al menos uno presente.
// ────────────────────────────────────────────────────────────────────────────

export const cambiosContextoSchema = z
  .object({
    hipotesisDiagnostica: z.string().nullable().optional(),
    resumenAcumulativo: z.string().nullable().optional(),
    objetivosTerapeuticos: z.array(objetivoSchema).optional(),
    intervencionesProbadas: z.array(intervencionSchema).optional(),
    temasRecurrentes: z.array(temaSchema).optional(),
    riesgosHistoricos: z.array(riesgoHistoricoSchema).optional(),
    ultimaSesionId: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Falta al menos un campo para actualizar",
  });
export type CambiosContexto = z.infer<typeof cambiosContextoSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Payload de respuesta (GET y PATCH)
// ────────────────────────────────────────────────────────────────────────────

export interface NotaResumen {
  sesionClinicaId: string;
  /** Posición DESC: 1 = más reciente. */
  numero: number;
  fechaSesion: string;
  notaAnalisis: string | null;
  notaPlan: string | null;
}

export interface ContextoPayload {
  pacienteId: string;
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  objetivosTerapeuticos: Objetivo[];
  intervencionesProbadas: Intervencion[];
  temasRecurrentes: Tema[];
  riesgosHistoricos: RiesgoHistorico[];
  ultimaSesionId: string | null;
  version: number;
  aprobadoPorTerapeutaEn: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
  /** Solo en la response (no se persiste): A+P de las últimas sesiones. */
  ultimasNotas: NotaResumen[];
  totalSesionesAprobadas: number;
}

/** Forma que devuelve el GET para un paciente sin contexto todavía. */
export function contextoVacio(pacienteId: string): ContextoPayload {
  return {
    pacienteId,
    hipotesisDiagnostica: null,
    resumenAcumulativo: null,
    objetivosTerapeuticos: [],
    intervencionesProbadas: [],
    temasRecurrentes: [],
    riesgosHistoricos: [],
    ultimaSesionId: null,
    version: 0,
    aprobadoPorTerapeutaEn: null,
    creadoEn: null,
    actualizadoEn: null,
    ultimasNotas: [],
    totalSesionesAprobadas: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Quién actualiza: decide `aprobadoPorTerapeutaEn` (ver actualizar.ts).
// ────────────────────────────────────────────────────────────────────────────

export type ActorContexto =
  | { tipo: "worker" }
  | { tipo: "terapeuta"; userId: string };
