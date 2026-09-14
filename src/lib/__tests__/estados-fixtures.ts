// Fixtures de los tests de integración del Área 2 (vida de la sesión
// clínica). No es un test: vitest no lo colecta.
//
// La base es un Postgres propio de esta área (docker, DATABASE_URL_TEST en
// localhost) o, en CI, la que el job levante. Acá no se trunca nada: cada
// archivo crea su organización con ids únicos y borra sólo lo suyo al
// terminar, así la misma base sirve a varios archivos a la vez.
//
// La URL pasa por la guarda de db-test.ts (sólo bases locales).

import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient, type EstadoSesion, type EstadoFeedback, type EstadoAudio } from "@prisma/client";

import type { ClienteTransaccional } from "@/app/api/_lib/casos-uso/sesion/transicion";
import type { EventoAuditoriaInput } from "@/app/api/_lib/auditoria-pura";
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

/** Llamar en beforeAll: fija una clave de cifrado propia y conecta. */
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

/**
 * La base es compartida: si otro agente la trunca mientras se insertan las
 * filas de un fixture, Postgres responde con una violación de clave foránea
 * (P2003). Se repite el fixture entero unas veces antes de darse por
 * vencido; un fallo persistente sigue siendo un fallo.
 */
export async function conReintentoFK<T>(accion: () => Promise<T>, intentos = 4): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await accion();
    } catch (error) {
      const codigo = (error as { code?: string } | null)?.code;
      if (codigo !== "P2003" || i >= intentos) throw error;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

export function crearOrg(prisma: PrismaClient, orientacion: "cbt_mi" | "gestalt" = "gestalt"): Promise<Org> {
  return conReintentoFK(() => crearOrgUnaVez(prisma, orientacion));
}

async function crearOrgUnaVez(prisma: PrismaClient, orientacion: "cbt_mi" | "gestalt"): Promise<Org> {
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
export const CLAVE_AUDIO = Buffer.alloc(32, 7).toString("base64");

export interface OpcionesSesion {
  estado: EstadoSesion;
  /** true (default): audio en R2 con clave y dos segmentos. */
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

export function crearSesion(
  prisma: PrismaClient,
  org: Org,
  opciones: OpcionesSesion,
): Promise<{ sesionId: string; turnoId: string }> {
  return conReintentoFK(() => crearSesionUnaVez(prisma, org, opciones));
}

async function crearSesionUnaVez(
  prisma: PrismaClient,
  org: Org,
  opciones: OpcionesSesion,
): Promise<{ sesionId: string; turnoId: string }> {
  const sesionId = randomUUID();
  const conAudio = opciones.audio ?? true;
  const campos: Partial<CamposSesionClinica> = {
    audioClave: conAudio ? CLAVE_AUDIO : null,
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
          segmentos: conAudio
            ? {
                create: [0, 1].map((indice) => ({
                  indice,
                  organizationId: org.orgId,
                  iv: randomBytes(12),
                  bytes: 1000 + indice,
                  sha256: "a".repeat(64),
                  confirmadoEn: new Date(),
                })),
              }
            : undefined,
        },
      },
    },
    select: { id: true },
  });
  return { sesionId, turnoId: turno.id };
}

/** Borra todo lo de una organización, en orden de claves foráneas. */
export async function limpiarOrg(prisma: PrismaClient, orgId: string | undefined): Promise<void> {
  if (!orgId) return;
  await prisma.trabajo.deleteMany({ where: { organizationId: orgId } });
  await prisma.eventoAuditoria.deleteMany({ where: { organizationId: orgId } });
  await prisma.sesionClinica.deleteMany({ where: { organizationId: orgId } });
  await prisma.turno.deleteMany({ where: { organizationId: orgId } });
  await prisma.hilo.deleteMany({ where: { organizationId: orgId } });
  await prisma.paciente.deleteMany({ where: { organizationId: orgId } });
  await prisma.configuracion.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

/** Auditoría como stub: junta los eventos en memoria. */
export function auditoriaEnMemoria() {
  const eventos: EventoAuditoriaInput[] = [];
  return {
    eventos,
    registrar: async (evento: EventoAuditoriaInput) => {
      eventos.push(evento);
    },
  };
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
      audioClave: true,
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
