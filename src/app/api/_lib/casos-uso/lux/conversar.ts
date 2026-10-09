// Casos de uso de Lux: abrir la conversación sobre un paciente (Lux habla
// primero) y responder una pregunta con su historial.
//
// Los dos hacen lo mismo en el mismo orden: clave del proveedor (503 si
// falta, antes de leer nada), material del paciente (404 si no es de la
// organización; las transcripciones que entran quedan auditadas), llamada al
// modelo con el bucle de herramientas, y devuelven el flujo. El rastro de la
// conversación (lux.abrir / lux.pregunta) lo escribe registrarConversacionLux
// cuando el stream terminó, porque recién ahí hay tokens: métricas y nada
// más. El texto de la conversación no se escribe en ninguna tabla ni log.
//
// Runtime nodejs: el prompt se lee del disco (src/lib/lux/prompt.ts).

import {
  crearConversacionConHerramientas,
  MODELO_LUX,
  type FlujoConversacion,
  type ResultadoConversacion,
} from "@/lib/anthropic-mensajes";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { ACCIONES } from "@/lib/auditoria-acciones";
import { LARGO_MAX_PREGUNTA_LUX, type TurnoHistorialLux } from "@/lib/lux/contrato";
import { systemPromptLux } from "@/lib/lux/prompt";

import { registrarAuditoria, type ClienteAuditoria } from "../../auditoria";
import { requirePaciente } from "../../pacientes";
import { ApiError } from "../../responses";
import { historialAMensajes, MAX_TURNOS_HISTORIAL } from "../responder-ayuda";
import { ejecutorLux, HERRAMIENTAS_LUX, type EjecutorLux } from "./herramientas";
import { armarMaterial, leidasEnHistorial, type ClienteLux, type MaterialLux } from "./material";

export { TOPE_LUX_DIA, MENSAJE_TOPE_LUX } from "./topes";

/** Incluye el razonamiento del modelo (thinking adaptativo de Haiku 5.5). */
export const MAX_TOKENS_LUX = 8000;
/** La conversación entera, todas las rondas. La ruta tiene 60 s. */
export const TIMEOUT_LUX_MS = 50_000;

export const MENSAJE_SIN_CLAVE_LUX =
  "Lux no está disponible en este momento. Probá más tarde; si sigue así, avisale a quien administra la app.";
export const MENSAJE_PROVEEDOR_CAIDO_LUX = "Lux no pudo contestarte ahora. Probá de nuevo en un ratito.";
export const MENSAJE_PREGUNTA_LARGA_LUX = `La pregunta es muy larga: máximo ${LARGO_MAX_PREGUNTA_LUX} caracteres.`;

/** Lo que recibe el modelo cuando ella abre la conversación sin preguntar.
 *  También encabeza un historial que empieza con la apertura de Lux: la API
 *  exige que el primer mensaje sea de la usuaria. */
export const PEDIDO_APERTURA =
  "(La profesional abrió la conversación sobre este paciente, sin pregunta. Hablá vos primero, como dice <apertura>.)";

interface ConversarBase {
  prisma: ClienteLux;
  organizationId: string;
  usuarioId: string;
  pacienteId: string;
  /** Por defecto process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Inyectable: los tests pasan un doble en vez de llamar a Anthropic. */
  crearConversacion?: typeof crearConversacionConHerramientas;
  /** Inyectable: evita leer el prompt del disco. */
  systemPrompt?: string;
}

export interface ConversacionLux {
  flujo: FlujoConversacion;
  material: Pick<MaterialLux, "notas" | "transcripciones" | "transcripcionesOmitidas" | "releidas" | "releidasOmitidas">;
  ejecutor: EjecutorLux;
}

/** El paciente es de la organización, o 404. La ruta lo llama antes de
 *  reservar cupo; armarMaterial lo vuelve a exigir por su cuenta. */
export async function autorizarPaciente(prisma: ClienteLux, organizationId: string, pacienteId: string): Promise<void> {
  await requirePaciente(prisma, pacienteId, organizationId);
}

export function abrirConversacion(input: ConversarBase): Promise<ConversacionLux> {
  return conversar(input, [{ role: "user", content: PEDIDO_APERTURA }]);
}

export function responder(input: ConversarBase & { pregunta: string; historial?: TurnoHistorialLux[] }): Promise<ConversacionLux> {
  const pregunta = input.pregunta.trim();
  if (pregunta === "") throw new ApiError("Escribí una pregunta.", 400);
  if (pregunta.length > LARGO_MAX_PREGUNTA_LUX) throw new ApiError(MENSAJE_PREGUNTA_LARGA_LUX, 400);
  const historial = input.historial ?? [];
  const previos: MessageParam[] = historialAMensajes(historial);
  if (previos[0]?.role === "assistant") previos.unshift({ role: "user", content: PEDIDO_APERTURA });
  // Las transcripciones que Lux leyó en los turnos que el modelo va a ver
  // (los mismos que deja historialAMensajes) vuelven al material.
  const vistos = historial.filter((t) => t.texto.trim() !== "").slice(-MAX_TURNOS_HISTORIAL);
  return conversar(input, [...previos, { role: "user", content: pregunta }], leidasEnHistorial(vistos));
}

async function conversar(input: ConversarBase, mensajes: MessageParam[], leidasEnConversacion: string[] = []): Promise<ConversacionLux> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[lux] ANTHROPIC_API_KEY no configurada");
    throw new ApiError(MENSAJE_SIN_CLAVE_LUX, 503);
  }

  // 404 si el paciente no es de la organización. Errores de base: 500.
  const material = await armarMaterial({
    prisma: input.prisma, organizationId: input.organizationId,
    pacienteId: input.pacienteId, usuarioId: input.usuarioId, leidasEnConversacion,
  });
  const ejecutor = ejecutorLux({
    prisma: input.prisma, organizationId: input.organizationId,
    usuarioId: input.usuarioId, abribles: material.abribles,
  });

  try {
    const flujo = await (input.crearConversacion ?? crearConversacionConHerramientas)(
      {
        model: MODELO_LUX,
        max_tokens: MAX_TOKENS_LUX,
        // Documentos arriba, instrucciones abajo; el corte de caché al final
        // cubre los dos (son estables mientras el material no cambie).
        system: [
          { type: "text", text: material.texto },
          { type: "text", text: input.systemPrompt ?? systemPromptLux(), cache_control: { type: "ephemeral" } },
        ],
        tools: HERRAMIENTAS_LUX,
        messages: mensajes,
      },
      ejecutor,
      { apiKey, timeoutMs: TIMEOUT_LUX_MS },
    );
    return {
      flujo,
      material: {
        notas: material.notas,
        transcripciones: material.transcripciones,
        transcripcionesOmitidas: material.transcripcionesOmitidas,
        releidas: material.releidas,
        releidasOmitidas: material.releidasOmitidas,
      },
      ejecutor,
    };
  } catch (error) {
    console.error("[lux] fallo del proveedor", error);
    throw new ApiError(MENSAJE_PROVEEDOR_CAIDO_LUX, 502);
  }
}

export interface ConversacionRespondida {
  prisma: ClienteAuditoria;
  organizationId: string;
  userId: string;
  pacienteId: string;
  tipo: "abrir" | "pregunta";
  conversacion: Pick<ConversacionLux, "material">;
  resultado: Pick<ResultadoConversacion, "tokensEntrada" | "tokensSalida" | "cacheLeido" | "cacheEscrito" | "llamadas" | "rondas">;
  largoPregunta: number;
  largoRespuesta: number;
  turnosHistorial: number;
}

/**
 * El rastro de una respuesta de Lux: qué paciente, cuánto material, cuántos
 * tokens, qué herramientas. NUNCA el texto de la pregunta ni el de la
 * respuesta, ni los argumentos de las herramientas (las lecturas ya quedaron
 * como sesion.ver_transcripcion). Informativo, como el de Lupita.
 */
export async function registrarConversacionLux(p: ConversacionRespondida): Promise<void> {
  const llamadas = p.resultado.llamadas;
  await registrarAuditoria(p.prisma, {
    organizationId: p.organizationId,
    actorTipo: "usuario",
    actorId: p.userId,
    accion: p.tipo === "abrir" ? ACCIONES.lux.abrir : ACCIONES.lux.pregunta,
    entidad: "paciente",
    entidadId: p.pacienteId,
    detalle: {
      modelo: MODELO_LUX,
      tokensEntrada: p.resultado.tokensEntrada,
      tokensSalida: p.resultado.tokensSalida,
      cacheLeido: p.resultado.cacheLeido,
      cacheEscrito: p.resultado.cacheEscrito,
      rondas: p.resultado.rondas,
      // El nombre lo escribe el modelo: sólo pasa si es de la lista cerrada.
      herramientas: llamadas.map((l) => (HERRAMIENTAS_LUX.some((h) => h.name === l.nombre) ? l.nombre : "desconocida")),
      lecturas: llamadas.filter((l) => !l.rechazada).length,
      rechazadas: llamadas.filter((l) => l.rechazada).length,
      notas: p.conversacion.material.notas,
      transcripcionesEnMaterial: p.conversacion.material.transcripciones.length,
      transcripcionesOmitidas: p.conversacion.material.transcripcionesOmitidas,
      // Las que volvieron al material porque Lux ya las había leído en la charla.
      releidas: p.conversacion.material.releidas.length,
      releidasOmitidas: p.conversacion.material.releidasOmitidas,
      largoPregunta: p.largoPregunta,
      largoRespuesta: p.largoRespuesta,
      turnosHistorial: p.turnosHistorial,
    },
  });
}
