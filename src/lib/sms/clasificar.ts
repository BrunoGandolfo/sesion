// La tabla de códigos de Twilio → qué hace el sistema. Puro, una sola fuente.
//
// Cada fila lleva el enlace a la documentación oficial con la que se
// verificó (11 de septiembre de 2026). Si Twilio cambia un código, se cambia
// acá y en ningún otro lado.
//
// Tres clases para una respuesta de la API de Messages:
//   aceptado    Twilio devolvió 2xx (queued/accepted). NO es "llegó".
//   transitorio vale la pena volver a intentar más tarde (backoff).
//   definitivo  no va a salir nunca así: fallido, con el código guardado.
// Y una cuarta que no es de la tabla sino del cliente HTTP: `desconocido`
// (se mandó el cuerpo y no hubo respuesta legible), que decide
// src/lib/sms/twilio.ts.
//
// Para los StatusCallback hay otra función: ahí el mensaje YA salió y lo que
// llega es el veredicto del operador.

import { SMS_MOTIVOS, SMS_CON_CODIGO } from "@/lib/glosario";
import type { MotivoBajaSms } from "@prisma/client";

export type ClaseRespuesta = "transitorio" | "definitivo";

export interface Clasificacion {
  clase: ClaseRespuesta;
  /** Si hay que despertar a alguien: es configuración o la cuenta, no un
   *  número. */
  alerta?: "critico" | "aviso";
  /** Texto para la pantalla cuando es definitivo (sin infraestructura). */
  motivoNoEnvio?: string;
  /** El destinatario pidió no recibir más: se crea BajaSms con este motivo. */
  baja?: MotivoBajaSms;
  /** Con 429 la espera lleva más jitter, para no volver todos juntos. */
  jitterMayor?: boolean;
  /** Enlace a la documentación de la fila. */
  referencia: string;
}

const ERRORES = "https://www.twilio.com/docs/api/errors";

const POR_CODIGO: Record<number, Clasificacion> = {
  // Autenticación: credenciales incorrectas, vencidas o de otra cuenta.
  20003: {
    clase: "definitivo",
    alerta: "critico",
    motivoNoEnvio: SMS_MOTIVOS.CREDENCIALES,
    referencia: `${ERRORES}/20003`,
  },
  // Demasiadas solicitudes concurrentes: seguro de reintentar con espera.
  20429: { clase: "transitorio", jitterMayor: true, referencia: `${ERRORES}/20429` },
  // 'To' no es un número válido (no cumple E.164).
  21211: {
    clase: "definitivo",
    motivoNoEnvio: SMS_MOTIVOS.TELEFONO_INVALIDO,
    referencia: `${ERRORES}/21211`,
  },
  // 'From' no es un número válido ni un sender ID aprobado: configuración.
  21212: {
    clase: "definitivo",
    alerta: "critico",
    motivoNoEnvio: SMS_MOTIVOS.EMISOR_INVALIDO,
    referencia: `${ERRORES}/21212`,
  },
  // 'To' no se puede alcanzar.
  21214: {
    clase: "definitivo",
    motivoNoEnvio: SMS_MOTIVOS.INALCANZABLE,
    referencia: `${ERRORES}/21214`,
  },
  // Permisos geográficos: el destino está deshabilitado para la cuenta.
  21408: {
    clase: "definitivo",
    alerta: "critico",
    motivoNoEnvio: SMS_MOTIVOS.PAIS_NO_HABILITADO,
    referencia: `${ERRORES}/21408`,
  },
  // 'From' no es un número con capacidad de SMS de esta cuenta.
  21606: {
    clase: "definitivo",
    alerta: "critico",
    motivoNoEnvio: SMS_MOTIVOS.EMISOR_SIN_SMS,
    referencia: `${ERRORES}/21606`,
  },
  // El destinatario respondió STOP a un mensaje anterior.
  21610: {
    clase: "definitivo",
    motivoNoEnvio: SMS_MOTIVOS.BAJA,
    baja: "twilio_21610",
    referencia: `${ERRORES}/21610`,
  },
  // 'To' no es un número móvil (fijo, o formato inválido).
  21614: {
    clase: "definitivo",
    motivoNoEnvio: SMS_MOTIVOS.NO_CELULAR,
    referencia: `${ERRORES}/21614`,
  },
  // Cola desbordada: demasiados mensajes en poco tiempo.
  30001: { clase: "transitorio", referencia: `${ERRORES}/30001` },
  // Cuenta suspendida (saldo, política, fraude): nadie más va a poder
  // mandar nada hasta que alguien lo resuelva.
  30002: { clase: "transitorio", alerta: "critico", referencia: `${ERRORES}/30002` },
};

/**
 * Clasifica una respuesta >= 400 de POST /Messages.json. `codigo` es el
 * `code` del cuerpo de error de Twilio (puede faltar si el cuerpo no se
 * pudo leer); `httpStatus` es el de la respuesta.
 */
export function clasificarRespuesta(
  httpStatus: number,
  codigo: number | null,
): Clasificacion {
  if (codigo !== null && POR_CODIGO[codigo]) return POR_CODIGO[codigo];
  // https://www.twilio.com/docs/usage/twilios-response#http-response-codes
  if (httpStatus === 429) {
    return { clase: "transitorio", jitterMayor: true, referencia: `${ERRORES}/20429` };
  }
  if (httpStatus >= 500) {
    return { clase: "transitorio", referencia: "https://www.twilio.com/docs/usage/twilios-response" };
  }
  // Cualquier 4xx no listado: definitivo, con el código guardado en la fila.
  return {
    clase: "definitivo",
    motivoNoEnvio: SMS_CON_CODIGO(SMS_MOTIVOS.RECHAZADO, codigo),
    referencia: codigo !== null ? `${ERRORES}/${codigo}` : "https://www.twilio.com/docs/usage/twilios-response",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// StatusCallback: el veredicto del operador sobre un mensaje que ya salió.
// https://www.twilio.com/docs/messaging/api/message-resource#twilios-request-to-the-statuscallback-url
// ────────────────────────────────────────────────────────────────────────────

export type VeredictoCallback =
  | { efecto: "entregado" }
  | { efecto: "no_entregado"; motivoNoEnvio: string; alerta?: "aviso" }
  | { efecto: "ignorar" };

const NO_ENTREGADO: Record<number, { motivoNoEnvio: string; alerta?: "aviso" }> = {
  // Teléfono apagado, sin señal o que no recibe SMS.
  30003: { motivoNoEnvio: SMS_MOTIVOS.SIN_SENAL },
  // El número no existe o ya no existe.
  30005: { motivoNoEnvio: SMS_MOTIVOS.INEXISTENTE },
  // Línea fija o el operador no es alcanzable.
  30006: { motivoNoEnvio: SMS_MOTIVOS.LINEA_FIJA },
  // Filtrado por Twilio o por el operador: el CONTENIDO está siendo bloqueado.
  30007: { motivoNoEnvio: SMS_MOTIVOS.BLOQUEADO, alerta: "aviso" },
};

/** Referencias de los códigos de callback, para el que lea el código. */
export const REFERENCIAS_CALLBACK: Record<number, string> = {
  30003: `${ERRORES}/30003`,
  30005: `${ERRORES}/30005`,
  30006: `${ERRORES}/30006`,
  30007: `${ERRORES}/30007`,
};

/**
 * `MessageStatus` y `ErrorCode` del callback → qué escribir en la fila.
 * `queued`, `sending`, `sent` son intermedios y no cambian nada: la fila ya
 * está en `aceptado`.
 */
export function clasificarCallback(
  estado: string,
  codigo: number | null,
): VeredictoCallback {
  switch (estado) {
    case "delivered":
    case "read":
      return { efecto: "entregado" };
    case "undelivered":
    case "failed": {
      const conocido = codigo !== null ? NO_ENTREGADO[codigo] : undefined;
      if (conocido) return { efecto: "no_entregado", ...conocido };
      return {
        efecto: "no_entregado",
        motivoNoEnvio:
          SMS_CON_CODIGO(SMS_MOTIVOS.NO_ENTREGADO, codigo),
      };
    }
    default:
      return { efecto: "ignorar" };
  }
}
