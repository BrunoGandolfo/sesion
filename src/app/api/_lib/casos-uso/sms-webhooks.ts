// Casos de uso de los dos webhooks de Twilio. Las rutas
// (/api/sms/callback, /api/sms/entrante) validan la firma y traducen;
// lo que se escribe en la base está acá, sin request ni Response.

import type { db } from "@/lib/db";
import { clasificarCallback, type VeredictoCallback } from "@/lib/sms/clasificar";

import { MOTIVO_BAJA } from "./despachar-sms";
import { cancelarPendientesDelDestino } from "./envios-del-turno";

type ClientePrisma = Pick<typeof db, "envioSms" | "bajaSms">;

export interface CallbackTwilio {
  /** MessageSid del mensaje. */
  sid: string;
  /** MessageStatus (delivered, undelivered, failed, sent, queued…). */
  estado: string;
  /** ErrorCode, si vino y es un número. */
  codigo: number | null;
  ahora: Date;
}

export type ResultadoCallback =
  | { efecto: "ignorar" }
  | { efecto: "entregado"; actualizados: number }
  | { efecto: "no_entregado"; actualizados: number; motivoNoEnvio: string; alerta?: "aviso" };

/**
 * StatusCallback: `delivered` → entregado; `undelivered`/`failed` →
 * no_entregado con el código y el motivo. Condicionado por `sid` Y por
 * estado `aceptado`: un callback tardío no reabre un envío terminal, y un
 * `sent`/`queued` intermedio no toca nada.
 */
export async function aplicarCallbackTwilio(
  prisma: Pick<ClientePrisma, "envioSms">,
  { sid, estado, codigo, ahora }: CallbackTwilio,
): Promise<ResultadoCallback> {
  const veredicto: VeredictoCallback = clasificarCallback(estado, codigo);
  if (veredicto.efecto === "ignorar") return { efecto: "ignorar" };

  if (veredicto.efecto === "entregado") {
    const { count } = await prisma.envioSms.updateMany({
      where: { sid, estado: "aceptado" },
      data: { estado: "entregado", cerradoEn: ahora },
    });
    return { efecto: "entregado", actualizados: count };
  }

  const { count } = await prisma.envioSms.updateMany({
    where: { sid, estado: "aceptado" },
    data: {
      estado: "no_entregado",
      codigoProveedor: codigo !== null ? String(codigo) : null,
      motivoNoEnvio: veredicto.motivoNoEnvio,
      cerradoEn: ahora,
    },
  });
  return {
    efecto: "no_entregado",
    actualizados: count,
    motivoNoEnvio: veredicto.motivoNoEnvio,
    ...(veredicto.alerta ? { alerta: veredicto.alerta } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Reconciliación de los envíos que se quedaron en `aceptado`
//
// Hasta el 7-oct-2026 todos los StatusCallback se rechazaron por firma
// (docs/operaciones.md §6): 43 envíos quedaron en `aceptado` aunque Twilio
// sabía cómo terminaron. Twilio no reenvía callbacks pasados. Esto pregunta
// por cada uno y aplica el estado por el MISMO camino que el callback
// (aplicarCallbackTwilio), así que un envío ya cerrado no se reabre y un
// `sent` sin acuse lo deja como está.
//
// Por defecto SIMULA: sólo cuenta qué haría. Escribe con `simular: false`.
// No avisa por correo (el 30007 de un mensaje de hace semanas no es una
// alarma de hoy): el resumen lo dice.
// ────────────────────────────────────────────────────────────────────────────

export type ConsultaMensaje =
  | { tipo: "ok"; status: string; codigo: number | null }
  | { tipo: "error"; mensaje: string };

export interface ReconciliarEnviosInput {
  prisma: Pick<ClientePrisma, "envioSms">;
  /** Cómo está el mensaje en Twilio (src/lib/sms/twilio.ts, consultarMensajeTwilio). */
  consultar: (sid: string) => Promise<ConsultaMensaje>;
  simular: boolean;
  ahora: Date;
  /** Tope de envíos por corrida. */
  limite?: number;
}

export interface FilaReconciliada {
  sid: string;
  /** Lo que dice Twilio, o null si no se pudo consultar. */
  status: string | null;
  codigo: number | null;
  efecto: "entregado" | "no_entregado" | "sin_cambio" | "error";
  /** Filas escritas (0 al simular). */
  actualizados: number;
}

export async function reconciliarEnvios({
  prisma,
  consultar,
  simular,
  ahora,
  limite = 500,
}: ReconciliarEnviosInput): Promise<FilaReconciliada[]> {
  const envios = await prisma.envioSms.findMany({
    where: { estado: "aceptado", sid: { not: null } },
    select: { sid: true },
    orderBy: { aceptadoEn: "asc" },
    take: limite,
  });
  const filas: FilaReconciliada[] = [];
  for (const { sid } of envios) {
    if (!sid) continue;
    const mensaje = await consultar(sid);
    if (mensaje.tipo === "error") {
      filas.push({ sid, status: null, codigo: null, efecto: "error", actualizados: 0 });
      continue;
    }
    const { status, codigo } = mensaje;
    if (simular) {
      const veredicto = clasificarCallback(status, codigo);
      filas.push({ sid, status, codigo, efecto: veredicto.efecto === "ignorar" ? "sin_cambio" : veredicto.efecto, actualizados: 0 });
      continue;
    }
    const resultado = await aplicarCallbackTwilio(prisma, { sid, estado: status, codigo, ahora });
    filas.push({
      sid,
      status,
      codigo,
      efecto: resultado.efecto === "ignorar" ? "sin_cambio" : resultado.efecto,
      actualizados: resultado.efecto === "ignorar" ? 0 : resultado.actualizados,
    });
  }
  return filas;
}

/** Lo que cuenta como pedido de baja, ya normalizado. */
export const PALABRAS_DE_BAJA: ReadonlySet<string> = new Set(["baja", "stop", "cancelar"]);

/** Minúsculas, sin tildes, sólo letras: "  Bája " → "baja". */
export function normalizarRespuesta(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function esPedidoDeBaja(texto: string): boolean {
  return PALABRAS_DE_BAJA.has(normalizarRespuesta(texto));
}

/**
 * La baja de un teléfono por respuesta: entra en bajas_sms (idempotente) y
 * se apaga todo lo pendiente a ese número, de cualquier motivo (decisión del
 * dueño). Devuelve cuántos envíos apagó.
 */
export async function registrarBajaPorRespuesta(
  prisma: ClientePrisma,
  telefono: string,
  ahora: Date,
): Promise<number> {
  await prisma.bajaSms.upsert({
    where: { telefono },
    update: {},
    create: { telefono, motivo: "respuesta_baja" },
  });
  return cancelarPendientesDelDestino(prisma, telefono, MOTIVO_BAJA, ahora);
}
