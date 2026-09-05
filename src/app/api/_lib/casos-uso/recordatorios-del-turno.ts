// La relación entre el estado de un turno y sus recordatorios. Una sola
// fuente de verdad para dos reglas que estaban repartidas —o directamente no
// estaban— en cada lugar que toca un turno.
//
// ─── REGLA 1: un turno que deja de estar programado no avisa nada ───────────
//
// Hasta hoy sólo el PATCH que CANCELA apagaba los recordatorios. Marcar el
// turno como "realizado" (lo hace la pantalla de grabar cuando termina la
// sesión, y lo hace cobrarTurno cuando se registra el pago de un turno que
// todavía estaba programado) o como "ausente" no apagaba nada: el
// recordatorio quedaba vivo y el cron lo mandaba igual.
//
// En la práctica se salvaba de casualidad, porque `estaVencido` del
// despachador descarta los turnos cancelados, ausentes y pasados. Pero eso
// es una red, no la regla: alcanza con un turno realizado ANTES de su hora
// —una sesión adelantada, o cobrada por adelantado— para que la paciente
// reciba el recordatorio de una sesión que ya tuvo. Y una fila viva es una
// fila que el rescate puede levantar.
//
// La regla es del dominio, no de una ruta: si el turno ya no espera a nadie,
// sus recordatorios se cierran. Punto. Se llama desde TODOS los puntos donde
// el estado del turno cambia:
//
//   - PATCH /api/turnos/[id]        (realizado | ausente | cancelado)
//   - PATCH /api/turnos/[id]        (reprogramación: la fecha cambió)
//   - cobrarTurno                   (programado → realizado)
//
// (La pantalla /grabar y el sheet de la agenda no escriben la base: los dos
// pasan por el PATCH de arriba.)
//
// ─── REGLA 2: un turno que ya pasó no se recuerda ───────────────────────────
//
// /grabar/nuevo crea el turno con `fecha: new Date()` —la sesión está
// empezando ahora mismo— y hasta hoy eso creaba igual un recordatorio, con
// `programadoEn` calculado hacia atrás (las 20:00 de ayer). El cron lo
// levantaba en el tick siguiente y le mandaba a la paciente un SMS
// recordándole la sesión que estaba teniendo en ese momento.
//
// No se arregla en el despachador: un recordatorio que nunca debió existir no
// tiene que llegar a la cola para que alguien lo descarte. Se arregla al
// crear.

import type { Recordatorio as FilaRecordatorio } from "@prisma/client";

import type { db } from "@/lib/db";
import {
  calcularProgramadoEn,
  normalizarRecordatorioModo,
} from "@/lib/recordatorios-programacion";

import { ESTADOS_CON_ENVIO_PENDIENTE } from "./enviar-recordatorios";

/**
 * Lo mínimo del cliente Prisma que este módulo necesita.
 *
 * `Pick` y no `typeof db` entero a propósito: casi todas estas llamadas
 * ocurren adentro de un `$transaction`, y el cliente de una transacción NO
 * es asignable al cliente completo (no tiene $transaction, $connect…). Con
 * el Pick, las dos formas entran.
 */
type ClienteRecordatorios = Pick<typeof db, "recordatorio" | "configuracion">;

/**
 * Estados en los que un turno ya no espera a nadie. Espejo de TurnoEstado
 * (src/types/domain.ts) menos "programado".
 */
export const ESTADOS_TURNO_CERRADO = [
  "realizado",
  "ausente",
  "cancelado",
] as const;

/** True si el turno sigue esperando a la paciente. */
export function turnoSigueProgramado(estado: string): boolean {
  return estado === "programado";
}

/**
 * Apaga todos los recordatorios del turno que todavía puedan mandar un SMS:
 * los que esperan su hora ("pendiente") y también los que quedaron
 * reservados ("enviando") por una corrida del cron que se murió — si la
 * reserva huérfana sobrevive, el rescate la levanta y manda el mensaje.
 *
 * Devuelve cuántas filas se apagaron. Idempotente: llamarla dos veces no
 * hace nada la segunda.
 */
export async function cerrarRecordatoriosDelTurno(
  prisma: ClienteRecordatorios,
  turnoId: string,
): Promise<number> {
  const { count } = await prisma.recordatorio.updateMany({
    where: {
      turnoId,
      estado: { in: [...ESTADOS_CON_ENVIO_PENDIENTE] },
    },
    data: { estado: "cancelado" },
  });
  return count;
}

/**
 * ¿Corresponde programar un recordatorio para un turno con esta fecha?
 *
 * No, si el turno ya empezó. Un recordatorio de algo que está pasando no es
 * un recordatorio, es una molestia — y con el cálculo hacia atrás
 * (dia_anterior, dos_dias_antes) sale con `programadoEn` en el pasado, así
 * que el cron lo dispara en el tick siguiente, no "a su hora".
 *
 * El borde exacto (`fecha === ahora`) cuenta como pasado: es el caso de
 * /grabar/nuevo, que crea el turno con la hora de este instante.
 */
export function correspondeRecordatorio(fechaTurno: Date, ahora: Date): boolean {
  return fechaTurno.getTime() > ahora.getTime();
}

export interface ProgramarRecordatorioParams {
  prisma: ClienteRecordatorios;
  turnoId: string;
  organizationId: string;
  fechaTurno: Date;
  /** Momento de la operación. Inyectado para que el caso sea determinista. */
  ahora: Date;
}

/**
 * Crea el recordatorio de un turno, si corresponde. Devuelve la fila creada,
 * o `null` si el turno ya pasó.
 *
 * El modo (dia_anterior / dos_dias_antes / misma_manana) sale de la
 * configuración de la organización, con el default como red. Estaba copiado
 * en POST /api/turnos y en el PATCH que reprograma; ahora es una sola lectura
 * y una sola cuenta.
 */
export async function programarRecordatorio({
  prisma,
  turnoId,
  organizationId,
  fechaTurno,
  ahora,
}: ProgramarRecordatorioParams): Promise<FilaRecordatorio | null> {
  if (!correspondeRecordatorio(fechaTurno, ahora)) return null;

  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId },
    select: { recordatorioModo: true },
  });

  return prisma.recordatorio.create({
    data: {
      turnoId,
      programadoEn: calcularProgramadoEn(
        fechaTurno,
        normalizarRecordatorioModo(configuracion?.recordatorioModo),
      ),
      estado: "pendiente",
    },
  });
}
