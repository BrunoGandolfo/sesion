// Fixtures de los tests de integración del Área 2 (vida de la sesión
// clínica). No es un test: vitest no lo colecta.
//
// La base es la de test de db-test.ts (guarda por nombre y host local). Una
// sola forma de limpiarla: cada archivo la vacía con `vaciarTablas` antes de
// sus casos (o antes de cada caso) y al terminar. Los archivos corren de a
// uno (vitest.config.ts), así que nadie la vacía a mitad de otro.

import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient, type EstadoSesion, type EstadoFeedback, type EstadoAudio } from "@prisma/client";

import type { ClienteTransaccional } from "@/app/api/_lib/casos-uso/sesion/transicion";
import { __resetLlaveroForTests, VARIABLE_LLAVERO } from "@/lib/llavero";
import {
  cifrarSesion,
  type CamposSesionClinica,
  type ClienteCifrado,
} from "@/lib/prisma-encryption";
import type { NotaSoap } from "@/lib/sesion-clinica/schema";

import { conectarBaseDeTest } from "./db-test";

export interface BaseArea2 {
  /** Cliente crudo: columnas físicas, fixtures, aserciones. */
  prisma: PrismaClient;
  /** El mismo cliente con la extensión de cifrado (campos lógicos). */
  db: ClienteCifrado & ClienteTransaccional;
}

/** Llamar en beforeAll: fija un llavero propio de la corrida y conecta. */
export function conectarArea2(): BaseArea2 {
  process.env[VARIABLE_LLAVERO] = `1=${randomBytes(32).toString("base64")}`;
  __resetLlaveroForTests();
  const { prisma, db } = conectarBaseDeTest();
  return { prisma, db: db as ClienteCifrado & ClienteTransaccional };
}

export interface Org {
  orgId: string;
  pacienteId: string;
  userId: string;
}

export async function crearOrg(prisma: PrismaClient, orientacion: "cbt_mi" | "gestalt" = "gestalt"): Promise<Org> {
  const orgId = randomUUID();
  const org = await prisma.organization.create({
    data: {
      id: orgId,
      nombre: `Área 2 ${orgId.slice(0, 8)}`,
      configuracion: {
        create: { nombreProfesional: "Lic. Prueba", tarifaDefault: 1000, orientacionTeorica: orientacion },
      },
      pacientes: {
        create: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000000", tarifa: 1000 },
      },
    },
    select: { id: true, pacientes: { select: { id: true } } },
  });
  return { orgId: org.id, pacienteId: org.pacientes[0].id, userId: `user-${orgId.slice(0, 8)}` };
}

export const NOTA: NotaSoap = { subjetivo: "S", objetivo: "O", analisis: "A", plan: "P" };
export const TRANSCRIPCION = "[00:00] S0: hola\n[00:05] S1: hola";

export interface OpcionesSesion {
  estado: EstadoSesion;
  /** true (default): audio en R2 con clave e IV. */
  audio?: boolean;
  transcripcion?: string | null;
  notaIa?: NotaSoap | null;
  datos?: unknown;
  feedback?: unknown;
  feedbackEstado?: EstadoFeedback;
  intento?: number;
  fallosSeguidos?: number;
  proximoIntentoEn?: Date | null;
  leaseVenceEn?: Date | null;
  ticketHash?: string | null;
  generacion?: number;
  falloCodigo?: string | null;
  audioEstado?: EstadoAudio;
}

export async function crearSesion(
  prisma: PrismaClient,
  org: Org,
  opciones: OpcionesSesion,
): Promise<{ sesionId: string; turnoId: string }> {
  const sesionId = randomUUID();
  const conAudio = opciones.audio ?? true;
  const campos: Partial<CamposSesionClinica> = {
    transcripcion: opciones.transcripcion ?? null,
    notaIa: opciones.notaIa ?? null,
    datos: opciones.datos ?? null,
    feedback: opciones.feedback ?? null,
  };
  const turno = await prisma.turno.create({
    data: {
      fecha: new Date("2026-09-01T14:00:00Z"),
      tarifaCobrada: 1000,
      pacienteId: org.pacienteId,
      organizationId: org.orgId,
      sesionClinica: {
        create: {
          // cifrarSesion devuelve { id, …columnas }: el id va una sola vez.
          organizationId: org.orgId,
          estado: opciones.estado,
          audioEstado: opciones.audioEstado ?? (conAudio ? "en_r2" : "sin_audio"),
          duracionAudioSeg: conAudio ? 120 : null,
          intento: opciones.intento ?? 0,
          fallosSeguidos: opciones.fallosSeguidos ?? 0,
          proximoIntentoEn: opciones.proximoIntentoEn === undefined ? new Date(0) : opciones.proximoIntentoEn,
          leaseVenceEn: opciones.leaseVenceEn ?? null,
          ticketHash: opciones.ticketHash ?? null,
          generacion: opciones.generacion ?? (opciones.notaIa ? 1 : 0),
          modeloAsr: opciones.transcripcion ? "assemblyai:universal-2" : null,
          modeloLlm: opciones.notaIa ? "anthropic:claude-sonnet-5" : null,
          feedbackEstado: opciones.feedbackEstado ?? "no_pedido",
          falloCodigo: opciones.falloCodigo ?? null,
          ...cifrarSesion(sesionId, campos),
        },
      },
    },
    select: { id: true },
  });
  return { sesionId, turnoId: turno.id };
}

/**
 * Los eventos de auditoría que quedaron EN LA BASE, del más viejo al más
 * nuevo. Reemplaza al doble en memoria que había acá: los casos de uso ya no
 * reciben la función de auditoría, escriben con el mismo cliente que el acto
 * (src/app/api/_lib/auditoria.ts), así que el rastro se lee de la tabla y el
 * test prueba que el INSERT ocurrió de verdad.
 */
export function eventosAuditoriaDe(
  prisma: PrismaClient,
  organizationId: string,
  /** La entidad auditada (una sesión, una paciente). Sin esto vienen todos
   *  los de la organización, que en un archivo de tests se acumulan. */
  entidadId?: string,
) {
  return prisma.eventoAuditoria.findMany({
    where: { organizationId, ...(entidadId ? { entidadId } : {}) },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
  });
}

/** Lee la fila cruda de una sesión (o null si ya no está). */
export function filaDe(prisma: PrismaClient, sesionId: string) {
  return prisma.sesionClinica.findUnique({ where: { id: sesionId } });
}

/** Los campos cifrados de una sesión, descifrados por la extensión. */
export function camposDe(db: ClienteCifrado, sesionId: string) {
  return db.sesionClinica.findUniqueOrThrow({
    where: { id: sesionId },
    select: {
      transcripcion: true,
      notaIa: true,
      datos: true,
      feedback: true,
      notaFinal: true,
      notasEdicion: true,
    },
  });
}

/** Trabajos de una sesión, del más viejo al más nuevo. */
export function trabajosDe(prisma: PrismaClient, sesionId: string) {
  return prisma.trabajo.findMany({ where: { sesionId }, orderBy: { creadoEn: "asc" } });
}

/** Pedido HTTP del worker con el ticket como Bearer. */
export function pedidoConTicket(ticket: string | null): Request {
  return new Request("http://app.test/api/x", {
    headers: ticket ? { authorization: `Bearer ${ticket}` } : {},
  });
}
