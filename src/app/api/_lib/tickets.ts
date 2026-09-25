// Tickets del worker: la credencial para escribir sobre UNA sesión (o UN
// trabajo) reclamado.
//
// PROCESSING_SECRET sólo autoriza reclamar (GET /pendientes y GET
// /trabajos/pendientes). Cada ítem reclamado trae un ticket de 32 bytes
// aleatorios en hex; la app guarda su sha256 en `ticket_hash` de la fila y
// el worker lo manda como `Authorization: Bearer <ticket>` en lease,
// checkpoint, asr y resultado. Así el worker no puede escribir fuera de lo
// que le entregaron.
//
// El ticket es UN mecanismo con el intento: cada reclamo emite uno nuevo y
// pisa el anterior, así que el ticket del reclamo viejo deja de autorizar en
// el mismo instante en que el intento deja de ser el vigente. No vence por
// reloj: un worker con lease vencido que nadie más reclamó sigue pudiendo
// entregar su resultado (esquema §2.4 y diseño 02 §9.1). Se anula al aceptar
// el resultado.
//
// Comparación por hash indexado (@unique), no en tiempo constante: el hash
// ya lo hace innecesario. Runtime nodejs (node:crypto): el proxy no importa
// este módulo.

import { createHash, randomBytes } from "node:crypto";

import type { db } from "@/lib/db";

import { ApiError } from "./responses";

export interface TicketEmitido {
  /** Lo que viaja al worker. Nunca se persiste. */
  ticket: string;
  /** sha256 hex: lo que va a la columna `ticket_hash`. */
  ticketHash: string;
}

export function hashDeTicket(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

export function emitirTicket(): TicketEmitido {
  const ticket = randomBytes(32).toString("hex");
  return { ticket, ticketHash: hashDeTicket(ticket) };
}

/** El Bearer del header, o null si no hay o no tiene forma de ticket. */
export function ticketDe(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [esquema, valor] = header.split(" ", 2);
  if (esquema !== "Bearer" || !valor) return null;
  return /^[0-9a-f]{64}$/.test(valor) ? valor : null;
}

const NO_AUTORIZADO = () => new ApiError("No autorizado", 401);

type ClienteTickets = Pick<typeof db, "sesionClinica" | "trabajo">;

export interface SesionAutorizada {
  sesionId: string;
  organizationId: string;
  /** El intento vigente de la fila: el caso de uso lo compara con el del cuerpo. */
  intento: number;
}

/**
 * Autoriza un pedido del worker sobre una sesión: el ticket del header tiene
 * que ser el de ESA sesión y la sesión tiene que estar en `procesando`. 401
 * en cualquier otro caso, sin decir cuál.
 */
export async function autorizarTicketSesion(
  request: Request,
  prisma: ClienteTickets,
  sesionId: string,
): Promise<SesionAutorizada> {
  const ticket = ticketDe(request);
  if (!ticket) throw NO_AUTORIZADO();

  const sesion = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, ticketHash: hashDeTicket(ticket), estado: "procesando" },
    select: { id: true, organizationId: true, intento: true },
  });
  if (!sesion) throw NO_AUTORIZADO();

  return {
    sesionId: sesion.id,
    organizationId: sesion.organizationId,
    intento: sesion.intento,
  };
}

export interface TrabajoAutorizado {
  trabajoId: string;
  organizationId: string;
  tipo: "borrar_audio_r2" | "borrar_transcript_asr" | "generar_feedback" | "integrar_contexto";
  sesionId: string | null;
  pacienteId: string | null;
  intentos: number;
  payload: unknown;
}

/** Ídem para un trabajo reclamado por el worker (`en_curso` con ese ticket). */
export async function autorizarTicketTrabajo(
  request: Request,
  prisma: ClienteTickets,
  trabajoId: string,
): Promise<TrabajoAutorizado> {
  const ticket = ticketDe(request);
  if (!ticket) throw NO_AUTORIZADO();

  const trabajo = await prisma.trabajo.findFirst({
    where: { id: trabajoId, ticketHash: hashDeTicket(ticket), estado: "en_curso" },
    select: {
      id: true,
      organizationId: true,
      tipo: true,
      sesionId: true,
      pacienteId: true,
      intentos: true,
      payload: true,
    },
  });
  if (!trabajo) throw NO_AUTORIZADO();

  return {
    trabajoId: trabajo.id,
    organizationId: trabajo.organizationId,
    tipo: trabajo.tipo,
    sesionId: trabajo.sesionId,
    pacienteId: trabajo.pacienteId,
    intentos: trabajo.intentos,
    payload: trabajo.payload,
  };
}
