import type { PedidoMensajes, ResultadoMensajes } from "@/lib/anthropic-mensajes";
import { AYUDA_FUERA_DE_ALCANCE, AYUDA_AGENDA_TITULOS, AYUDA_AGENDA_VACIA } from "@/lib/glosario";
import { consultaAgendaSchema, type PeriodoAgenda, type TurnoLupita } from "./agenda";

export type ConsultarAgenda = (periodo: PeriodoAgenda) => Promise<TurnoLupita[]>;

export const HERRAMIENTAS_AYUDA: NonNullable<PedidoMensajes["tools"]> = [{
  name: "consultar_agenda",
  description: "Lee los turnos sin cancelar de HOY, MAÑANA o ESTA SEMANA (lunes a domingo), en Montevideo. Usala para preguntas sobre turnos reales: quién viene, cuándo, a qué hora, duración o modalidad. Devuelve el listado completo del período, ordenado, solo con nombre de pila, día, hora, duración y modalidad. No lee fichas, apellidos, teléfonos, importes ni contenido clínico. No escribe. Elegí el período de la pregunta actual, incluyendo seguimientos como '¿y mañana?'; nunca reutilices una agenda del historial. El servidor muestra el listado directamente: no escribas texto antes de esta llamada ni inventes turnos.",
  input_schema: {
    type: "object",
    properties: { periodo: { type: "string", enum: [...consultaAgendaSchema.shape.periodo.options] } },
    required: ["periodo"],
    additionalProperties: false,
  },
}, {
  name: "fuera_de_alcance",
  description: "Responde con el límite explícito de Lupita. Usala si piden datos de teléfonos, tarifas, deudas, cobros, notas, transcripciones, Recorrido, consentimientos o fichas, cambios de cualquier tipo, otro consultorio, u otro período de agenda. También si mezclan agenda con datos prohibidos. No la uses para explicar CÓMO usar esas pantallas: eso sí se responde desde la ayuda. No escribas texto antes de llamar. Si falta el período, preguntá si quiere hoy, mañana o esta semana.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
}];

/** Lista cerrada, argumentos validados y una sola lectura. El modelo nunca
 * elige organización, columnas, SQL, URL ni operaciones de escritura. */
export async function resolverHerramienta(
  resultado: ResultadoMensajes,
  consultar: ConsultarAgenda,
): Promise<string | null> {
  const llamadas = resultado.herramientas ?? [];
  if (!llamadas.length) return null;
  if (resultado.motivoDeCorte !== "tool_use" || llamadas.length !== 1) return AYUDA_FUERA_DE_ALCANCE;
  const llamada = llamadas[0];
  if (llamada.nombre !== "consultar_agenda") return AYUDA_FUERA_DE_ALCANCE;
  const consulta = consultaAgendaSchema.safeParse(llamada.entrada);
  if (!consulta.success) return AYUDA_FUERA_DE_ALCANCE;
  const turnos = await consultar(consulta.data.periodo);
  const titulo = AYUDA_AGENDA_TITULOS[consulta.data.periodo];
  // La IA no vuelve a redactar los datos: no puede cambiar la hora ni omitir
  // turnos por su límite de tokens. Tampoco recibe el resultado de la consulta.
  return `${titulo}\n${turnos.length ? turnos.map((turno) =>
    `${turno.dia} · ${turno.hora} · ${turno.nombre.replace(/\s+/g, " ").trim()} · ${turno.duracion} min · ${turno.modalidad}`,
  ).join("\n") : AYUDA_AGENDA_VACIA}`;
}
