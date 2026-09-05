// Caso de uso: cobrar una sesión, y descobrarla.
//
// Cobrar implica que la sesión ocurrió. Hasta ahora no: el turno tenía que
// estar en "realizado" antes de aceptar el pago, y marcarlo realizado era
// otra pantalla (el sheet de la agenda, que además se cierra al guardar).
// El resultado era que cobrar una sesión que no se grabó costaba seis
// toques y saber una regla que la interfaz no dice en ningún lado: la fila
// de Hoy simplemente no ofrecía "Cobrar".
//
// Acá la sesión se cierra y se cobra en la misma sentencia. El estado del
// turno es una consecuencia del cobro, no un requisito previo.
//
// Lo que NO hace: revertir el estado al descobrar. Que un pago se haya
// registrado por error no significa que la sesión no haya ocurrido, y
// "realizado" es un hecho clínico, no contable.

import type { db } from "@/lib/db";
import type { MetodoPago, Turno } from "@/types/domain";

import { toTurno } from "../domain";
import { ApiError } from "../responses";
import { cerrarRecordatoriosDelTurno } from "./recordatorios-del-turno";

type ClientePrisma = typeof db;

export interface CobrarTurnoInput {
  prisma: ClientePrisma;
  turnoId: string;
  organizationId: string;
  metodo: MetodoPago;
  /** Momento del cobro: se guarda en pagoFecha y decide si la hora del
   *  turno ya pasó. Se inyecta para que el caso de uso sea determinista. */
  fecha: Date;
}

export interface DescobrarTurnoInput {
  prisma: ClientePrisma;
  turnoId: string;
  organizationId: string;
}

export const MENSAJE_YA_COBRADO = "El turno ya está cobrado";
export const MENSAJE_CANCELADO =
  "El turno está cancelado: no hay sesión para cobrar";
export const MENSAJE_AUSENTE =
  "La paciente no vino a este turno: no hay sesión para cobrar";
export const MENSAJE_NO_EMPEZO =
  "La sesión todavía no empezó: vas a poder cobrarla cuando llegue la hora";
export const MENSAJE_CONFLICTO =
  "El turno cambió mientras se cobraba. Probá de nuevo.";
export const MENSAJE_NO_COBRADO = "El turno no está cobrado";

/**
 * Registra el pago de un turno.
 *
 * - "programado" con la hora ya pasada: pasa a "realizado" y queda pagado,
 *   en una sola sentencia.
 * - "realizado": queda pagado.
 * - "programado" con la hora todavía por venir: ApiError 400.
 * - "cancelado" o "ausente": ApiError 400.
 * - ya pagado: ApiError 400.
 */
export async function cobrarTurno({
  prisma,
  turnoId,
  organizationId,
  metodo,
  fecha,
}: CobrarTurnoInput): Promise<Turno> {
  const existente = await prisma.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: { id: true, estado: true, pagoEstado: true, fecha: true },
  });

  if (!existente) {
    throw new ApiError("Turno no encontrado", 404);
  }

  if (existente.pagoEstado === "pagado") {
    throw new ApiError(MENSAJE_YA_COBRADO, 400);
  }

  if (existente.estado === "cancelado") {
    throw new ApiError(MENSAJE_CANCELADO, 400);
  }

  if (existente.estado === "ausente") {
    throw new ApiError(MENSAJE_AUSENTE, 400);
  }

  // Único caso en que el cobro además cierra el turno.
  const cierraElTurno = existente.estado === "programado";

  if (cierraElTurno && existente.fecha.getTime() > fecha.getTime()) {
    throw new ApiError(MENSAJE_NO_EMPEZO, 400);
  }

  return prisma.$transaction(async (tx) => {
    // updateMany condicionado al estado y al pago que se leyeron: si otra
    // pestaña cobró primero, o el turno se canceló entre la lectura y esta
    // línea, count es 0 y no se pisa nada. Estado y pago se escriben en la
    // misma sentencia: no existe un instante con la sesión cobrada y todavía
    // "programada".
    const { count } = await tx.turno.updateMany({
      where: {
        id: turnoId,
        organizationId,
        estado: existente.estado,
        pagoEstado: "pendiente",
      },
      data: {
        ...(cierraElTurno ? { estado: "realizado" } : {}),
        pagoEstado: "pagado",
        pagoFecha: fecha,
        pagoMetodo: metodo,
      },
    });

    if (count === 0) {
      throw new ApiError(MENSAJE_CONFLICTO, 409);
    }

    // Cobrar un turno que estaba programado lo cierra, y un turno cerrado no
    // avisa nada. El caso real: una sesión adelantada que se cobra antes de
    // su hora dejaba el recordatorio vivo, y la paciente recibía el SMS de
    // una sesión que ya había tenido.
    if (cierraElTurno) {
      await cerrarRecordatoriosDelTurno(tx, turnoId);
    }

    const turno = await tx.turno.findFirstOrThrow({
      where: { id: turnoId, organizationId },
    });

    return toTurno(turno);
  });
}

/**
 * Deshace el cobro: el turno vuelve a estar pendiente de pago y se olvidan
 * fecha y método. El estado del turno no se toca (ver nota de arriba).
 * Mismo comportamiento y mismos mensajes que antes de extraer el caso de uso.
 */
export async function descobrarTurno({
  prisma,
  turnoId,
  organizationId,
}: DescobrarTurnoInput): Promise<Turno> {
  const existente = await prisma.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: { id: true, pagoEstado: true },
  });

  if (!existente) {
    throw new ApiError("Turno no encontrado", 404);
  }

  if (existente.pagoEstado !== "pagado") {
    throw new ApiError(MENSAJE_NO_COBRADO, 400);
  }

  // La organización va en el WHERE de la escritura, igual que en cobrarTurno:
  // `update({ where: { id } })` deshace el cobro aunque el turno sea de otra
  // organización, y entre el findFirst de arriba y esta línea hay una
  // ventana. Con updateMany la pertenencia es parte de la operación.
  //
  // No se le agrega `pagoEstado: "pagado"` como hace cobrarTurno: descobrar
  // dos veces deja el mismo resultado, así que convertir un doble clic en un
  // 409 sería cambiar el comportamiento sin ganar nada.
  const { count } = await prisma.turno.updateMany({
    where: { id: turnoId, organizationId },
    data: {
      pagoEstado: "pendiente",
      pagoFecha: null,
      pagoMetodo: null,
    },
  });

  if (count === 0) {
    throw new ApiError("Turno no encontrado", 404);
  }

  const turno = await prisma.turno.findFirstOrThrow({
    where: { id: turnoId, organizationId },
  });

  return toTurno(turno);
}
