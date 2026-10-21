// La memoria de Lux: la conversación sobre UNA paciente, guardada turno a
// turno en conversaciones_lux para que ella pueda volver otro día y seguir.
//
// Qué se guarda: la pregunta de ella y la respuesta de Lux tal como llegó a
// la pantalla (prosa, <citas> y las líneas de estado con la marca del
// servidor), cifradas con el mismo llavero que las notas
// (src/lib/prisma-encryption.ts, campo `contenido`). Una apertura es sólo el
// turno de Lux. Una respuesta cortada se guarda con lo que llegó e
// `interrumpida`; si no llegó nada, no se guarda nada (la pregunta vuelve al
// campo en la pantalla).
//
// Quién escribe: sólo el servidor, cuando la respuesta terminó (la ruta, a
// través de registrarConversacionLux). La pantalla no manda historial: lo
// lee de acá (GET) y el modelo también. "Empezar de cero" la borra entera,
// con su rastro (lux.borrar_conversacion), en la misma transacción.
//
// Toda consulta va por organización Y paciente: la conversación de una
// paciente no aparece con el id de otra ni desde otra organización. Ningún
// log lleva texto.

import { randomUUID } from "node:crypto";

import type { db } from "@/lib/db";
import {
  LARGO_MAX_PREGUNTA_LUX, LARGO_MAX_TURNO_LUX, MAX_TURNOS_HISTORIAL_LUX, sinMarcasLux,
  type TurnoConversacionLux,
} from "@/lib/lux/contrato";
import { ACCIONES } from "@/lib/auditoria-acciones";
import { cifrarConversacionLux } from "@/lib/prisma-encryption";

import { auditar } from "../../auditoria";
import { requirePaciente } from "../../pacientes";

export type ClienteMemoriaLux = typeof db;

export interface IdentidadLux {
  organizationId: string;
  pacienteId: string;
}

export interface TurnoGuardadoLux {
  rol: "profesional" | "lux";
  texto: string;
  interrumpida: boolean;
  creadoEn: Date;
}

/** Cuántas filas se leen por cada turno que se devuelve: deja lugar para
 *  descartar aperturas sin contestar. */
const VENTANA_POR_TURNO = 4;

/** Los últimos `limite` turnos de la paciente, del más viejo al más nuevo.
 *  Cada visita guarda una apertura: las que ella no contestó (la siguiente
 *  no es una pregunta suya) se descartan, salvo la última, que es la que
 *  tiene delante. Sin esto, abrir la pestaña seis veces dejaba al modelo un
 *  historial de puros saludos. */
export async function cargarConversacion(
  prisma: ClienteMemoriaLux,
  { organizationId, pacienteId }: IdentidadLux,
  limite: number = MAX_TURNOS_HISTORIAL_LUX,
): Promise<TurnoGuardadoLux[]> {
  const filas = await prisma.conversacionLux.findMany({
    where: { organizationId, pacienteId },
    select: { id: true, rol: true, contenido: true, interrumpida: true, creadoEn: true },
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: limite * VENTANA_POR_TURNO,
  });
  const turnos = filas.reverse().map((f) => ({ rol: f.rol, texto: f.contenido, interrumpida: f.interrumpida, creadoEn: f.creadoEn }));
  return turnos.filter((t, i) => {
    const esApertura = t.rol === "lux" && turnos[i - 1]?.rol !== "profesional";
    return !esApertura || i === turnos.length - 1 || turnos[i + 1].rol === "profesional";
  }).slice(-limite);
}

/** GET de la pantalla: 404 si la paciente no es de la organización; si no,
 *  lo guardado, con la fecha como texto. */
export async function conversacionGuardada(
  prisma: ClienteMemoriaLux, organizationId: string, pacienteId: string,
): Promise<TurnoConversacionLux[]> {
  await requirePaciente(prisma, pacienteId, organizationId);
  const turnos = await cargarConversacion(prisma, { organizationId, pacienteId });
  return turnos.map((t) => ({ ...t, creadoEn: t.creadoEn.toISOString() }));
}

export interface GuardarTurnosInput extends IdentidadLux {
  userId: string;
  /** Cuándo llegó el pedido. Si después hubo un "Empezar de cero", no se
   *  guarda nada: la respuesta que estaba en vuelo no revive lo borrado.
   *  Por defecto, la hora de la pregunta (o de la respuesta). */
  pedidoEn?: Date;
  /** Ausente en la apertura. `en`: cuándo llegó el pedido. */
  pregunta?: { texto: string; en: Date };
  /** `en`: cuándo terminó (o se cortó) la respuesta. */
  respuesta: { texto: string; en: Date; interrumpida: boolean };
}

/** Guarda el intercambio que acaba de cerrar. Sin texto de Lux no guarda
 *  nada. 404 si la paciente no es de la organización. */
export async function guardarTurnos(prisma: ClienteMemoriaLux, input: GuardarTurnosInput): Promise<void> {
  const respuesta = input.respuesta.texto.trim();
  if (respuesta === "") return;
  const { organizationId, pacienteId, userId } = input;
  const turnos: { rol: TurnoGuardadoLux["rol"]; texto: string; en: Date; interrumpida: boolean }[] = [];
  if (input.pregunta) {
    // La marca es del servidor: en la pregunta de ella no vale.
    turnos.push({
      rol: "profesional", texto: sinMarcasLux(input.pregunta.texto).trim().slice(0, LARGO_MAX_PREGUNTA_LUX),
      en: input.pregunta.en, interrumpida: false,
    });
  }
  // La respuesta va siempre después de su pregunta, aunque el reloj diga lo mismo.
  const despues = Math.max(input.respuesta.en.getTime(), (input.pregunta?.en.getTime() ?? -Infinity) + 1);
  turnos.push({
    rol: "lux", texto: respuesta.slice(0, LARGO_MAX_TURNO_LUX), en: new Date(despues),
    interrumpida: input.respuesta.interrumpida,
  });

  const pedidoEn = input.pedidoEn ?? input.pregunta?.en ?? input.respuesta.en;
  await prisma.$transaction(async (tx) => {
    await bloquearPaciente(tx, organizationId, pacienteId);
    const borradaDespues = await tx.eventoAuditoria.findFirst({
      where: {
        organizationId, entidad: "paciente", entidadId: pacienteId,
        accion: ACCIONES.lux.borrarConversacion, creadoEn: { gte: pedidoEn },
      },
      select: { id: true },
    });
    if (borradaDespues) return;
    await tx.conversacionLux.createMany({
      data: turnos.map((t) => ({
        ...cifrarConversacionLux(randomUUID(), { contenido: t.texto }),
        organizationId, pacienteId, userId, rol: t.rol, interrumpida: t.interrumpida, creadoEn: t.en,
      })),
    });
  });
}

/** "Empezar de cero": borra toda la conversación guardada de la paciente y
 *  deja lux.borrar_conversacion (cuántos turnos, sin texto) en la misma
 *  transacción. 404 si la paciente no es de la organización. */
export async function borrarConversacion(
  prisma: ClienteMemoriaLux, input: IdentidadLux & { userId: string },
): Promise<number> {
  const { organizationId, pacienteId, userId } = input;
  return prisma.$transaction(async (tx) => {
    await bloquearPaciente(tx, organizationId, pacienteId);
    const { count } = await tx.conversacionLux.deleteMany({ where: { organizationId, pacienteId } });
    // `auditar` y no `registrarAuditoria`: este evento es además la marca
    // que guardarTurnos mira para no revivir una respuesta en vuelo. Si no
    // se puede escribir, el borrado tampoco queda.
    await auditar(tx, {
      organizationId, actorTipo: "usuario", actorId: userId,
      accion: ACCIONES.lux.borrarConversacion, entidad: "paciente", entidadId: pacienteId,
      detalle: { turnos: count },
    });
    return count;
  });
}

type TxMemoria = Parameters<Parameters<ClienteMemoriaLux["$transaction"]>[0]>[0];

/** 404 si la paciente no es de la organización. Si es, bloquea su fila
 *  (NO KEY: no frena altas de turnos ni el INSERT de la conversación) hasta
 *  el fin de la transacción: guardar y "Empezar de cero" se serializan, y
 *  guardar ve el borrado que terminó antes. */
async function bloquearPaciente(tx: TxMemoria, organizationId: string, pacienteId: string): Promise<void> {
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pacientes
    WHERE id = ${pacienteId} AND organization_id = ${organizationId} FOR NO KEY UPDATE`;
  if (filas.length === 0) await requirePaciente(tx, pacienteId, organizationId);
}
