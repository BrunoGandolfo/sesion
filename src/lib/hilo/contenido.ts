import { z } from "zod";

import { confianzaModeloSchema, flagRiesgoSchema, tipoIntervencionSchema } from "@/lib/sesion-clinica/schema";

// El contenido completo de una versión, incluido lo que propone cambiar la IA.
// Las fechas son días del consultorio, no instantes interpretados por el navegador.
const dia = z.iso.date();
const texto = z.string().trim().min(1).max(20_000);

export const contenidoHiloSchema = z.strictObject({
  hipotesisDiagnostica: z.string().max(20_000).nullable(),
  resumenAcumulativo: z.string().max(60_000).nullable(),
  objetivosTerapeuticos: z.array(z.strictObject({
    id: z.string().min(1).max(120), descripcion: texto,
    estado: z.enum(["activo", "cerrado", "pausado"]),
    fechaInicio: dia, fechaCierre: dia.nullable(),
  })).max(200),
  intervencionesProbadas: z.array(z.strictObject({
    tecnica: tipoIntervencionSchema, eficaciaPercibida: confianzaModeloSchema,
    sesiones: z.array(z.string().uuid()).max(2000),
  })).max(200),
  temasRecurrentes: z.array(z.strictObject({ tema: texto, conteo: z.number().int().positive() })).max(200),
  riesgosHistoricos: z.array(z.strictObject({
    sesionId: z.string().uuid(), fecha: dia, flag: flagRiesgoSchema, detalle: texto,
  })).max(2000),
  cambios: z.array(texto).max(100),
});

export type ContenidoHilo = z.infer<typeof contenidoHiloSchema>;

export function hiloVacio(): ContenidoHilo {
  return {
    hipotesisDiagnostica: null, resumenAcumulativo: null,
    objetivosTerapeuticos: [], intervencionesProbadas: [], temasRecurrentes: [],
    riesgosHistoricos: [], cambios: [],
  };
}

export const editarHiloSchema = z.strictObject({
  basadaEnVersion: z.number().int().nonnegative(), contenido: contenidoHiloSchema,
});
export const aceptarHiloSchema = z.strictObject({
  basadaEnVersion: z.number().int().nonnegative(), contenido: contenidoHiloSchema.optional(),
});
export const resolverHiloSchema = z.strictObject({ basadaEnVersion: z.number().int().nonnegative() });
export const regenerarHiloSchema = z.strictObject({
  basadaEnVersion: z.number().int().nonnegative(),
  propuestaId: z.string().uuid().optional(), trabajoId: z.string().uuid().optional(),
}).refine(v => Boolean(v.propuestaId) !== Boolean(v.trabajoId), "Indicá una propuesta o un trabajo fallido");

export interface ResumenVersionHilo {
  id: string;
  version: number;
  basadaEnVersion: number | null;
  actor: "profesional" | "ia";
  estado: "aplicada" | "propuesta" | "desactualizada" | "rechazada";
  sesionOrigenId: string | null;
  creadaPorUserId: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  resueltaPorUserId: string | null;
  propuestaOrigenId: string | null;
}
export interface VersionHilo extends ResumenVersionHilo { contenido: ContenidoHilo }
export interface Recorrido {
  pacienteId: string;
  vigente: VersionHilo | null;
  propuesta: VersionHilo | null;
  desactualizadas: ResumenVersionHilo[];
  historial: ResumenVersionHilo[];
  hayMas: boolean;
  totalSesionesAprobadas: number;
  sesionesAprobadas: { id: string; fecha: string }[];
  trabajos: { id: string; sesionId: string | null; estado: "pendiente" | "en_curso" | "fallido" }[];
}
