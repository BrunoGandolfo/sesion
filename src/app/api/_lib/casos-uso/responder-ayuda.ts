// Caso de uso: contestar una pregunta de ayuda.
//
// Recibe la pregunta y el historial ya parseados, arma la llamada a Anthropic
// y devuelve la respuesta con sus métricas. No lee `request`, no devuelve
// `Response` y no toca la base salvo para contar (ver contarPreguntasDelDia).
//
// LO QUE NUNCA SALE DE ACÁ
//
// Un fallo del proveedor —clave inválida, 500 de Anthropic, timeout— se
// loguea con detalle y se traduce a un ApiError con texto para la usuaria.
// El mensaje de ErrorAnthropic trae el cuerpo del proveedor y no se pasa
// nunca a la respuesta HTTP.
//
// Runtime nodejs: importa el corpus, que lee del disco.

import {
  crearMensaje,
  MODELO_AYUDA,
  systemCacheado,
  type MensajeAnthropic,
  type ResultadoMensajes,
} from "@/lib/anthropic-mensajes";
import { systemPromptAyuda } from "@/lib/ayuda-corpus";
import type { db } from "@/lib/db";
import { inicioDelDiaMvd } from "@/lib/fechas-montevideo";

import { ApiError } from "../responses";

type ClientePrisma = typeof db;

/** Largo máximo de una pregunta. Mide caracteres, no tokens: es un tope
 *  contra el pegado accidental de media pantalla, no un control de gasto. */
export const LARGO_MAX_PREGUNTA = 600;

/** Cuántos turnos previos entran. Un turno es un mensaje, de cualquiera de
 *  las dos. Con 6 alcanza para un "¿y si no me anduvo?" encadenado, y el
 *  historial nunca crece hasta pesar como el corpus. */
export const MAX_TURNOS_HISTORIAL = 6;

/** Techo de la respuesta. Los límites piden 3 a 8 líneas; 1024 tokens son
 *  varias veces eso, así que solo corta una respuesta ya descarrilada. */
export const MAX_TOKENS_RESPUESTA = 1024;

/** Cuántas preguntas por usuaria por día. */
export const TOPE_PREGUNTAS_DIA = 40;

/** La acción con la que se auditan las preguntas. Es también la que cuenta
 *  el límite diario: si cambia acá, cambia el conteo. */
export const ACCION_AYUDA = "ayuda.pregunta";
export const ENTIDAD_AYUDA = "usuario";

// ── Mensajes para la usuaria ────────────────────────────────────────────────
// Explícitos y con nombre: los tests los verifican y no dicen nada de la
// causa técnica.

export const MENSAJE_SIN_CLAVE =
  "La ayuda no está disponible en este momento. Probá más tarde; si sigue así, avisale a quien administra la app.";

export const MENSAJE_PROVEEDOR_CAIDO =
  "No pude responderte ahora mismo. Probá de nuevo en un ratito.";

export const MENSAJE_TOPE_DIARIO = `Por hoy llegaste a las ${TOPE_PREGUNTAS_DIA} preguntas. Mañana se renueva. Mientras tanto, la ayuda escrita está toda en la app.`;

export const MENSAJE_PREGUNTA_VACIA = "Escribí una pregunta.";

export const MENSAJE_PREGUNTA_LARGA = `La pregunta es muy larga: máximo ${LARGO_MAX_PREGUNTA} caracteres.`;

// ────────────────────────────────────────────────────────────────────────────

export interface TurnoAyuda {
  rol: "usuaria" | "asistente";
  texto: string;
}

export interface ResponderAyudaInput {
  pregunta: string;
  /** Los turnos previos, del más viejo al más nuevo. Se recortan a los
   *  últimos MAX_TURNOS_HISTORIAL. */
  historial?: TurnoAyuda[];
  /** Por defecto process.env.ANTHROPIC_API_KEY. Explícito para los tests. */
  apiKey?: string;
  /** Inyectable: los tests pasan un doble en vez de llamar a Anthropic. */
  crear?: typeof crearMensaje;
  /** Inyectable: evita leer el corpus del disco en los tests del caso de uso. */
  systemPrompt?: string;
}

export interface RespuestaAyuda {
  respuesta: string;
  tokensEntrada: number;
  tokensSalida: number;
  cacheLeido: number;
}

/**
 * Los últimos MAX_TURNOS_HISTORIAL turnos, traducidos a la forma que espera
 * la API. Se recorta por el final —los más nuevos son los que importan— y se
 * descartan los turnos vacíos, que la API rechaza.
 */
export function historialAMensajes(
  historial: readonly TurnoAyuda[],
): MensajeAnthropic[] {
  return historial
    .filter((turno) => turno.texto.trim() !== "")
    .slice(-MAX_TURNOS_HISTORIAL)
    .map((turno) => ({
      role: turno.rol === "usuaria" ? ("user" as const) : ("assistant" as const),
      content: turno.texto.trim(),
    }));
}

/**
 * Cuántas preguntas lleva hoy esta usuaria, contando los eventos de
 * auditoría del día de Montevideo. No hay tabla de cuotas: la auditoría ya
 * escribe una fila por pregunta contestada, y una fila más sería otra cosa
 * que puede quedar desincronizada.
 *
 * Consecuencia deliberada: solo cuentan las preguntas CONTESTADAS. Una
 * llamada que falló no gasta cuota — la usuaria no recibió nada por ella.
 */
export async function contarPreguntasDelDia(
  prisma: ClientePrisma,
  params: { organizationId: string; userId: string; ahora?: Date },
): Promise<number> {
  const desde = inicioDelDiaMvd(params.ahora ?? new Date());

  return prisma.eventoAuditoria.count({
    where: {
      organizationId: params.organizationId,
      accion: ACCION_AYUDA,
      entidad: ENTIDAD_AYUDA,
      entidadId: params.userId,
      createdAt: { gte: desde },
    },
  });
}

/**
 * Lanza ApiError 429 si la usuaria ya llegó al tope del día.
 *
 * El conteo y la escritura del evento no son atómicos: dos pedidos
 * simultáneos en el borde pueden dejar pasar uno de más. Con una usuaria y
 * un tope de 40 no vale una transacción; el tope es contra el uso distraído,
 * no contra un atacante (que además necesita sesión).
 */
export async function assertBajoElTope(
  prisma: ClientePrisma,
  params: { organizationId: string; userId: string; ahora?: Date },
): Promise<void> {
  const usadas = await contarPreguntasDelDia(prisma, params);
  if (usadas >= TOPE_PREGUNTAS_DIA) {
    throw new ApiError(MENSAJE_TOPE_DIARIO, 429);
  }
}

/**
 * Pregunta → respuesta. Lanza ApiError 400 (pregunta inválida), 503 (sin
 * clave configurada) o 502 (el proveedor falló).
 */
export async function responderAyuda(
  input: ResponderAyudaInput,
): Promise<RespuestaAyuda> {
  const pregunta = input.pregunta.trim();

  if (pregunta === "") {
    throw new ApiError(MENSAJE_PREGUNTA_VACIA, 400);
  }
  if (pregunta.length > LARGO_MAX_PREGUNTA) {
    throw new ApiError(MENSAJE_PREGUNTA_LARGA, 400);
  }

  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No es un error del que haya que enterarse por Sentry cada vez: es el
    // estado normal en local. Se loguea una línea y se contesta 503.
    console.warn("[ayuda] ANTHROPIC_API_KEY no configurada");
    throw new ApiError(MENSAJE_SIN_CLAVE, 503);
  }

  const crear = input.crear ?? crearMensaje;
  const system = input.systemPrompt ?? systemPromptAyuda();

  let resultado: ResultadoMensajes;
  try {
    resultado = await crear(
      {
        model: MODELO_AYUDA,
        max_tokens: MAX_TOKENS_RESPUESTA,
        // El system va primero y entero: es el prefijo que se cachea.
        system: systemCacheado(system),
        // Todo lo variable va después del corte del caché.
        messages: [
          ...historialAMensajes(input.historial ?? []),
          { role: "user", content: pregunta },
        ],
      },
      { apiKey },
    );
  } catch (error) {
    // El detalle del proveedor va al log de la función y muere ahí.
    console.error("[ayuda] fallo del proveedor", error);
    throw new ApiError(MENSAJE_PROVEEDOR_CAIDO, 502);
  }

  return {
    respuesta: resultado.texto,
    tokensEntrada: resultado.tokensEntrada,
    tokensSalida: resultado.tokensSalida,
    cacheLeido: resultado.cacheLeido,
  };
}
