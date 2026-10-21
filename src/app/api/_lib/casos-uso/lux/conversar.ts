// Casos de uso de Lux: abrir la conversación sobre un paciente (Lux habla
// primero) y responder una pregunta con su historial.
//
// Los dos hacen lo mismo en el mismo orden: clave del proveedor (503 si
// falta, antes de leer nada), historial, material del paciente (404 si no es
// de la organización; las transcripciones que entran quedan auditadas),
// llamada al modelo con el bucle de herramientas, y devuelven el flujo. El
// rastro de la conversación (lux.abrir / lux.pregunta) lo escribe
// registrarConversacionLux cuando el stream terminó, porque recién ahí hay
// tokens: métricas y nada más. El texto de la conversación no va a ningún
// log ni a la auditoría: sólo a conversaciones_lux, cifrado (memoria.ts).
//
// Runtime nodejs: el prompt se lee del disco (src/lib/lux/prompt.ts).

import {
  crearConversacionConHerramientas,
  diagnosticoDe,
  esErrorHttpDelProveedor,
  MODELO_LUX,
  type FlujoConversacion,
  type ProgresoConversacion,
} from "@/lib/anthropic-mensajes";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { ACCIONES } from "@/lib/auditoria-acciones";
import { MAX_TURNOS_HISTORIAL } from "@/lib/ayuda-contrato";
import {
  LARGO_MAX_HISTORIAL_LUX, LARGO_MAX_PREGUNTA_LUX, sinMarcasLux, type TurnoHistorialLux,
} from "@/lib/lux/contrato";
import { systemPromptLux } from "@/lib/lux/prompt";

import { registrarAuditoria, type ClienteAuditoria } from "../../auditoria";
import { requirePaciente } from "../../pacientes";
import { ApiError } from "../../responses";
import { ErrorProveedorAsistente } from "../ayuda/reservar-cupo";
import { ejecutorLux, HERRAMIENTAS_LUX, type EjecutorLux } from "./herramientas";
import { armarMaterial, leidasEnHistorial, type ClienteLux, type MaterialLux } from "./material";
import { cargarConversacion, type TurnoGuardadoLux } from "./memoria";

/** Incluye el razonamiento del modelo (thinking adaptativo de Haiku 5.5). */
export const MAX_TOKENS_LUX = 8000;
/** La conversación entera, todas las rondas. La ruta tiene 60 s. */
export const TIMEOUT_LUX_MS = 50_000;

export const MENSAJE_SIN_CLAVE_LUX =
  "Lux no está disponible en este momento. Probá más tarde; si sigue así, avisale a quien administra la app.";
export const MENSAJE_PROVEEDOR_CAIDO_LUX = "Lux no pudo contestarte ahora. Probá de nuevo en un ratito.";
export const MENSAJE_PREGUNTA_LARGA_LUX = `La pregunta es muy larga: máximo ${LARGO_MAX_PREGUNTA_LUX} caracteres.`;

/** Falló la llamada a Anthropic, antes de que empiece la respuesta. Cuándo
 *  vuelve el cupo: ErrorProveedorAsistente (ayuda/reservar-cupo.ts). */
export class ErrorProveedorLux extends ErrorProveedorAsistente {
  constructor(devuelveCupo = false) {
    super(MENSAJE_PROVEEDOR_CAIDO_LUX, devuelveCupo);
  }
}

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
  /** Cuántos turnos anteriores llegaron al modelo. */
  turnosHistorial: number;
  material: Pick<MaterialLux, "notas" | "notasOmitidas" | "transcripciones" | "transcripcionesOmitidas" | "releidas" | "releidasOmitidas">;
  ejecutor: EjecutorLux;
}

/** El paciente es de la organización, o 404. La ruta lo llama antes de
 *  reservar cupo; armarMaterial lo vuelve a exigir por su cuenta. */
export async function autorizarPaciente(prisma: ClienteLux, organizationId: string, pacienteId: string): Promise<void> {
  await requirePaciente(prisma, pacienteId, organizationId);
}

/** La apertura: lo guardado de esta paciente (conversaciones_lux) y, al
 *  final, el pedido de que Lux hable primero. */
export function abrirConversacion(input: ConversarBase): Promise<ConversacionLux> {
  return conversar(input, async () => paraElModelo(await cargarConversacion(input.prisma, input)), PEDIDO_APERTURA);
}

export function responder(input: ConversarBase & { pregunta: string; historial?: TurnoHistorialLux[] }): Promise<ConversacionLux> {
  const pregunta = input.pregunta.trim();
  if (pregunta === "") throw new ApiError("Escribí una pregunta.", 400);
  if (pregunta.length > LARGO_MAX_PREGUNTA_LUX) throw new ApiError(MENSAJE_PREGUNTA_LARGA_LUX, 400);
  return conversar(input, async () => input.historial ?? [], pregunta);
}

/** Lo guardado, como lo lee el modelo: una respuesta cortada no viaja (la
 *  pregunta que la pidió, sí). */
export function paraElModelo(turnos: readonly TurnoGuardadoLux[]): TurnoHistorialLux[] {
  return turnos
    .filter((t) => !(t.rol === "lux" && t.interrumpida))
    .map((t) => ({ rol: t.rol === "profesional" ? "usuaria" : "asistente", texto: t.texto }));
}

/** Los mensajes del historial. El modelo lee sus turnos sin la marca del
 *  servidor (el material, con ella). Un turno de Lux que no responde a una
 *  pregunta (una apertura) va precedido del pedido de apertura: la API
 *  exige que el primer mensaje sea de la usuaria. */
function mensajesDe(vistos: readonly TurnoHistorialLux[]): MessageParam[] {
  const mensajes: MessageParam[] = [];
  for (const t of vistos) {
    if (t.rol === "asistente" && mensajes.at(-1)?.role !== "user") mensajes.push({ role: "user", content: PEDIDO_APERTURA });
    mensajes.push({ role: t.rol === "usuaria" ? "user" : "assistant", content: sinMarcasLux(t.texto) });
  }
  return mensajes;
}

/** Los turnos que llegan al modelo: los últimos MAX_TURNOS_HISTORIAL no
 *  vacíos y, si entre todos pasan LARGO_MAX_HISTORIAL_LUX caracteres, sin
 *  los más viejos que hagan falta para que entren. */
export function historialQueViaja(historial: readonly TurnoHistorialLux[]): TurnoHistorialLux[] {
  const turnos = historial
    .map((t) => ({ rol: t.rol, texto: t.texto.trim() }))
    .filter((t) => t.texto !== "")
    .slice(-MAX_TURNOS_HISTORIAL);
  let largo = turnos.reduce((total, t) => total + t.texto.length, 0);
  while (largo > LARGO_MAX_HISTORIAL_LUX) largo -= turnos.shift()!.texto.length;
  return turnos;
}

async function conversar(
  input: ConversarBase,
  historial: () => Promise<TurnoHistorialLux[]>,
  ultimo: string,
): Promise<ConversacionLux> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[lux] ANTHROPIC_API_KEY no configurada");
    throw new ApiError(MENSAJE_SIN_CLAVE_LUX, 503);
  }

  const vistos = historialQueViaja(await historial());
  const mensajes: MessageParam[] = [...mensajesDe(vistos), { role: "user", content: ultimo }];

  // 404 si el paciente no es de la organización. Errores de base: 500. Las
  // transcripciones que Lux leyó en los turnos que el modelo va a ver
  // vuelven al material.
  const material = await armarMaterial({
    prisma: input.prisma, organizationId: input.organizationId,
    pacienteId: input.pacienteId, usuarioId: input.usuarioId, leidasEnConversacion: leidasEnHistorial(vistos),
  });
  const ejecutor = ejecutorLux({
    prisma: input.prisma, organizationId: input.organizationId, pacienteId: input.pacienteId,
    usuarioId: input.usuarioId, abribles: material.abribles, caracteresLibres: material.caracteresLibres,
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
      turnosHistorial: vistos.length,
      material: {
        notas: material.notas,
        notasOmitidas: material.notasOmitidas,
        transcripciones: material.transcripciones,
        transcripcionesOmitidas: material.transcripcionesOmitidas,
        releidas: material.releidas,
        releidasOmitidas: material.releidasOmitidas,
      },
      ejecutor,
    };
  } catch (error) {
    // Sólo status y código: el mensaje puede traer el cuerpo del proveedor.
    console.error("[lux] fallo del proveedor", diagnosticoDe(error));
    throw new ErrorProveedorLux(esErrorHttpDelProveedor(error));
  }
}

export interface ConversacionRespondida {
  prisma: ClienteAuditoria;
  organizationId: string;
  userId: string;
  pacienteId: string;
  tipo: "abrir" | "pregunta";
  conversacion: Pick<ConversacionLux, "material">;
  resultado: ProgresoConversacion;
  largoPregunta: number;
  largoRespuesta: number;
  turnosHistorial: number;
  /** true: se canceló o se cortó a mitad. Los tokens son los de las rondas
   *  que alcanzaron a cerrar, y el largo, el de lo que llegó a la pantalla. */
  interrumpida?: boolean;
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
      notasOmitidas: p.conversacion.material.notasOmitidas,
      transcripcionesEnMaterial: p.conversacion.material.transcripciones.length,
      transcripcionesOmitidas: p.conversacion.material.transcripcionesOmitidas,
      // Las que volvieron al material porque Lux ya las había leído en la charla.
      releidas: p.conversacion.material.releidas.length,
      releidasOmitidas: p.conversacion.material.releidasOmitidas,
      largoPregunta: p.largoPregunta,
      largoRespuesta: p.largoRespuesta,
      turnosHistorial: p.turnosHistorial,
      ...(p.interrumpida ? { interrumpida: true } : {}),
    },
  });
}
