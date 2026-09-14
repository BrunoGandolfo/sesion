// Casos de uso de los dos webhooks de Twilio. Las rutas
// (/api/sms/callback, /api/sms/entrante) validan la firma y traducen;
// lo que se escribe en la base está acá, sin request ni Response.

import type { db } from "@/lib/db";
import { clasificarCallback, type VeredictoCallback } from "@/lib/sms/clasificar";

import { MOTIVO_BAJA } from "./despachar-sms";

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
  const { count } = await prisma.envioSms.updateMany({
    where: { destino: telefono, estado: { in: ["pendiente", "enviando"] } },
    data: { estado: "cancelado", motivoNoEnvio: MOTIVO_BAJA, cerradoEn: ahora },
  });
  return count;
}
