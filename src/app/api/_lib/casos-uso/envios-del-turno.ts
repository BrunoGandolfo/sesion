// La relación entre un turno y sus SMS: programar, reprogramar, cancelar.
// Contrato con el área de turnos (área 6): estas tres funciones se llaman
// DENTRO de la misma transacción que escribe el turno, con el `tx` de
// Prisma. Las tres son idempotentes y devuelven void (cancelar devuelve
// cuántas apagó, por comodidad de los tests).
//
//   programarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, ahora })
//     turno nuevo, o reabierto (realizado/ausente → programado).
//   reprogramarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, fechaTurnoPrevia, ahora })
//     la fecha cambió: apaga lo pendiente y programa el aviso de la fecha
//     nueva; si ya había salido un aviso para la fecha previa, el nuevo es
//     un CAMBIO DE HORARIO (sale ya) y no un segundo "te recordamos".
//   cancelarEnviosDelTurno(tx, turnoId, motivo)
//     el turno dejó de estar programado (cancelado, realizado, ausente).
//
// Y uno con el área de pacientes: cancelarEnviosDeLaPaciente(tx, { organizationId,
// pacienteId }) apaga todo lo pendiente de la paciente al archivarla.
//
// ─── LA CLAVE DE IDEMPOTENCIA ES LO QUE IMPIDE EL DUPLICADO ─────────────────
//
//   turno:<turnoId>:<fechaTurno ISO>
//
// Dos pedidos con la misma clave son el mismo mensaje: llamar a programar
// dos veces (dos pestañas, un reintento del PATCH) crea una sola fila.
// Reprogramar cambia la fecha y por lo tanto la clave: es un mensaje
// distinto, y eso es correcto, porque la paciente tiene que enterarse.
//
// ─── UN TELÉFONO VACÍO SE DICE ENSEGUIDA ────────────────────────────────────
//
// Antes se descubría en el cron, tras gastar tres intentos. Ahora la fila
// nace `fallido` con el motivo en castellano, así la pantalla del turno lo
// muestra en el acto. (El teléfono se valida al escribir la paciente, área 2:
// acá sólo se congela el que hay.)
//
// ─── UN TURNO QUE YA PASÓ NO SE RECUERDA ────────────────────────────────────
//
// /grabar/nuevo crea el turno con `fecha: ahora`. Un recordatorio de algo
// que está pasando no es un recordatorio: no se crea.

import { MOTIVO_SIN_TELEFONO, MOTIVO_TURNO_CERRADO, MOTIVO_REPROGRAMADO } from "@/lib/glosario";
import type { EstadoEnvioSms, MotivoSms } from "@prisma/client";

import type { db } from "@/lib/db";
import { partesMvd } from "@/lib/fechas-montevideo";
import {
  calcularProgramadoEn,
  normalizarRecordatorioModo,
} from "@/lib/recordatorios-programacion";

/**
 * Lo mínimo del cliente Prisma que este módulo necesita. `Pick` y no
 * `typeof db` entero: el cliente de una transacción no es asignable al
 * cliente completo (no tiene $transaction); con el Pick entran los dos.
 */
export type ClienteEnvios = Pick<typeof db, "envioSms" | "paciente" | "configuracion">;

/** Estados desde los que un envío TODAVÍA puede terminar mandando un SMS. */
export const ESTADOS_CON_ENVIO_PENDIENTE = ["pendiente", "enviando"] as const;

export { MOTIVO_TURNO_CERRADO } from "@/lib/glosario";

export function claveDelTurno(turnoId: string, fechaTurno: Date): string {
  return `turno:${turnoId}:${fechaTurno.toISOString()}`;
}

/** Día de Montevideo AAAA-MM-DD, para la clave del aviso de cobro. */
export function claveDeCobro(pacienteId: string, ahora: Date): string {
  const { anio, mes, dia } = partesMvd(ahora);
  const mm = String(mes + 1).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return `cobro:${pacienteId}:${anio}-${mm}-${dd}`;
}

/** True si el turno sigue esperando a la paciente. */
export function turnoSigueProgramado(estado: string): boolean {
  return estado === "programado";
}

/** ¿Corresponde un aviso para un turno con esta fecha? No, si ya empezó. */
export function correspondeEnvio(fechaTurno: Date, ahora: Date): boolean {
  return fechaTurno.getTime() > ahora.getTime();
}

export interface ProgramarEnvioParams {
  turnoId: string;
  organizationId: string;
  pacienteId: string;
  fechaTurno: Date;
  /** Momento de la operación. Inyectado para que el caso sea determinista. */
  ahora: Date;
  /** Default recordatorio_turno. Reprogramar decide cambio_de_horario. */
  motivo?: Extract<MotivoSms, "recordatorio_turno" | "cambio_de_horario">;
}

/**
 * Crea (o revive) el envío del turno. Idempotente por clave.
 *
 * Si ya existe una fila con esa clave:
 *   - en `cancelado` y sin haber salido nunca (sin sid ni aceptadoEn) → se
 *     revive a `pendiente`. Es el caso del turno reabierto sin tocar la
 *     fecha: el cierre lo había apagado y hay que volver a avisar.
 *   - en cualquier otro estado → no se toca. Ya salió, o está en camino.
 */
export async function programarEnvioDelTurno(
  tx: ClienteEnvios,
  { turnoId, organizationId, pacienteId, fechaTurno, ahora, motivo = "recordatorio_turno" }: ProgramarEnvioParams,
): Promise<void> {
  if (!correspondeEnvio(fechaTurno, ahora)) return;

  const [paciente, configuracion] = await Promise.all([
    tx.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { telefono: true },
    }),
    tx.configuracion.findUnique({
      where: { organizationId },
      select: { recordatorioModo: true },
    }),
  ]);
  if (!paciente) return;

  const destino = paciente.telefono.trim();
  const clave = claveDelTurno(turnoId, fechaTurno);
  const programadoEn =
    motivo === "cambio_de_horario"
      ? ahora
      : calcularProgramadoEn(fechaTurno, normalizarRecordatorioModo(configuracion?.recordatorioModo), turnoId);

  const existente = await tx.envioSms.findUnique({
    where: { claveIdempotencia: clave },
    select: { estado: true, sid: true, aceptadoEn: true },
  });

  if (existente) {
    if (existente.estado === "cancelado" && existente.sid === null && existente.aceptadoEn === null) {
      await tx.envioSms.updateMany({
        where: { claveIdempotencia: clave, estado: "cancelado" },
        data: destino
          ? { estado: "pendiente", motivo, programadoEn, proximoIntentoEn: programadoEn, motivoNoEnvio: null, cerradoEn: null }
          : { estado: "fallido", motivo, programadoEn, proximoIntentoEn: null, motivoNoEnvio: MOTIVO_SIN_TELEFONO, cerradoEn: ahora },
      });
    }
    return;
  }

  try {
    await tx.envioSms.create({
      data: {
        organizationId,
        claveIdempotencia: clave,
        motivo,
        pacienteId,
        turnoId,
        destino,
        programadoEn,
        ...(destino
          ? { estado: "pendiente", proximoIntentoEn: programadoEn }
          : { estado: "fallido", proximoIntentoEn: null, motivoNoEnvio: MOTIVO_SIN_TELEFONO, cerradoEn: ahora }),
      },
    });
  } catch (error) {
    // Carrera entre dos llamadas con la misma clave: la segunda choca con el
    // UNIQUE. Es exactamente el duplicado que la clave existe para impedir;
    // no es un error hacia afuera.
    if ((error as { code?: string } | null)?.code === "P2002") return;
    throw error;
  }
}

/**
 * Apaga los envíos del turno que todavía pueden mandar un SMS: los que
 * esperan su hora y también los reservados por una corrida del cron que se
 * murió (si la reserva huérfana sobrevive, el rescate la levanta). Devuelve
 * cuántos apagó. Idempotente.
 */
export async function cancelarEnviosDelTurno(
  tx: ClienteEnvios,
  turnoId: string,
  motivo: string = MOTIVO_TURNO_CERRADO,
  ahora: Date = new Date(),
): Promise<number> {
  const { count } = await tx.envioSms.updateMany({
    where: { turnoId, estado: { in: [...ESTADOS_CON_ENVIO_PENDIENTE] } },
    data: { estado: "cancelado", motivoNoEnvio: motivo, cerradoEn: ahora },
  });
  return count;
}

/** Por qué se apagó un envío al archivar a la paciente. Distinto del de la
 *  baja: la baja la pidió la paciente, archivar lo decidió la profesional. */
export const MOTIVO_PACIENTE_ARCHIVADA = "la paciente está archivada";

/**
 * Apaga los envíos de la paciente que todavía pueden mandar un SMS, de
 * cualquier motivo (turno o cobro). Es lo que hace archivar, dentro de su
 * transacción. `cancelado` es terminal: volver a activar a la paciente no
 * los revive. Devuelve cuántos apagó. Idempotente.
 */
export async function cancelarEnviosDeLaPaciente(
  tx: Pick<ClienteEnvios, "envioSms">,
  { organizationId, pacienteId }: { organizationId: string; pacienteId: string },
  motivo: string = MOTIVO_PACIENTE_ARCHIVADA,
  ahora: Date = new Date(),
): Promise<number> {
  const { count } = await tx.envioSms.updateMany({
    where: { pacienteId, organizationId, estado: { in: [...ESTADOS_CON_ENVIO_PENDIENTE] } },
    data: { estado: "cancelado", motivoNoEnvio: motivo, cerradoEn: ahora },
  });
  return count;
}

/** Estados en los que un SMS pudo haber llegado al teléfono: Twilio lo
 *  aceptó (o no sabemos), aunque el operador después no lo entregara. */
export const ESTADOS_QUE_PUDIERON_LLEGAR = ["aceptado", "entregado", "no_entregado", "desconocido"] as const;

export interface ReprogramarEnvioParams {
  turnoId: string;
  organizationId: string;
  pacienteId: string;
  fechaTurno: Date;
  fechaTurnoPrevia: Date;
  ahora: Date;
}

/**
 * La fecha del turno cambió. Se apaga lo pendiente de la fecha vieja y se
 * programa el aviso de la nueva. Si para ESTE TURNO ya había salido algún
 * aviso (Twilio lo aceptó, o quedó en desconocido: pudo haber salido), el
 * nuevo es un `cambio_de_horario` y sale ya; si no, es el recordatorio de
 * siempre, a su hora. Se mira cualquier fecha anterior, no sólo la inmediata:
 * un turno movido dos veces (A → B → C) cuya paciente recibió el aviso de A
 * y no el de B tiene que enterarse igual de que ahora es C. Idempotente: con
 * la misma fecha no hace nada.
 */
export async function reprogramarEnvioDelTurno(
  tx: ClienteEnvios,
  { turnoId, organizationId, pacienteId, fechaTurno, fechaTurnoPrevia, ahora }: ReprogramarEnvioParams,
): Promise<void> {
  if (fechaTurno.getTime() === fechaTurnoPrevia.getTime()) return;

  await cancelarEnviosDelTurno(tx, turnoId, MOTIVO_REPROGRAMADO, ahora);

  const yaAviso = await tx.envioSms.findFirst({
    where: {
      turnoId,
      claveIdempotencia: { not: claveDelTurno(turnoId, fechaTurno) },
      OR: [
        { estado: { in: [...ESTADOS_QUE_PUDIERON_LLEGAR] } },
        { aceptadoEn: { not: null } },
      ],
    },
    select: { id: true },
  });

  await programarEnvioDelTurno(tx, {
    turnoId,
    organizationId,
    pacienteId,
    fechaTurno,
    ahora,
    motivo: yaAviso ? "cambio_de_horario" : "recordatorio_turno",
  });
}

export interface ProgramarCobroParams {
  organizationId: string;
  pacienteId: string;
  ahora: Date;
}

/**
 * Aviso de cobro (lo aprieta la profesional desde Cobros; nunca sale solo).
 * Un aviso por paciente y por día de Montevideo: la clave lo garantiza. El
 * texto se arma en el momento de mandar (casos-uso/despachar-sms.ts, con
 * la deuda vigente), no acá. Devuelve el id del envío y si se creó ahora.
 */
export async function programarEnvioDeCobro(
  tx: ClienteEnvios,
  { organizationId, pacienteId, ahora }: ProgramarCobroParams,
): Promise<{ envioId: string; creado: boolean }> {
  const paciente = await tx.paciente.findFirst({
    where: { id: pacienteId, organizationId },
    select: { telefono: true },
  });
  if (!paciente) throw new Error("Paciente no encontrado");
  const destino = paciente.telefono.trim();
  const clave = claveDeCobro(pacienteId, ahora);

  const existente = await tx.envioSms.findUnique({ where: { claveIdempotencia: clave }, select: { id: true } });
  if (existente) return { envioId: existente.id, creado: false };

  const creado = await tx.envioSms.create({
    data: {
      organizationId,
      claveIdempotencia: clave,
      motivo: "recordatorio_cobro",
      pacienteId,
      turnoId: null,
      destino,
      programadoEn: ahora,
      ...(destino
        ? { estado: "pendiente", proximoIntentoEn: ahora }
        : { estado: "fallido", proximoIntentoEn: null, motivoNoEnvio: MOTIVO_SIN_TELEFONO, cerradoEn: ahora }),
    },
    select: { id: true },
  });
  return { envioId: creado.id, creado: true };
}

// ─── LECTURA PARA LA PANTALLA ────────────────────────────────────────────────

/** Lo que la pantalla del turno puede saber de cada SMS. Sin el teléfono
 *  (ya lo tiene en la ficha) y sin el texto (no se guarda). */
export interface EnvioDelTurno {
  id: string;
  motivo: MotivoSms;
  estado: EstadoEnvioSms;
  programadoEn: Date;
  intentos: number;
  aceptadoEn: Date | null;
  cerradoEn: Date | null;
  codigoProveedor: string | null;
  motivoNoEnvio: string | null;
}

/**
 * Los envíos de un turno, el más reciente primero, acotados a la
 * organización (un id de otro consultorio devuelve lista vacía, no 404: no
 * se revela si existe). Reemplaza a GET /api/recordatorios?turnoId=.
 */
export async function enviosDelTurno(
  tx: Pick<ClienteEnvios, "envioSms">,
  organizationId: string,
  turnoId: string,
): Promise<EnvioDelTurno[]> {
  return tx.envioSms.findMany({
    where: { turnoId, organizationId },
    orderBy: { creadoEn: "desc" },
    select: {
      id: true,
      motivo: true,
      estado: true,
      programadoEn: true,
      intentos: true,
      aceptadoEn: true,
      cerradoEn: true,
      codigoProveedor: true,
      motivoNoEnvio: true,
    },
  });
}
