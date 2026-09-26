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

import { sePuedeCobrar, toTurno } from "../domain";
import { ApiError } from "../responses";
import { cancelarEnviosDelTurno } from "./envios-del-turno";

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
  /** Versión del turno pagado que la profesional pretende deshacer. */
  actualizadoEn: Date;
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

/** Por qué no se puede cobrar un turno que sePuedeCobrar rechazó. El orden
 *  es el de siempre: primero el pago, después el estado, al final la hora. */
function motivoDelRechazo(turno: { estado: string; pagoEstado: string }): string {
  if (turno.pagoEstado === "pagado") return MENSAJE_YA_COBRADO;
  if (turno.estado === "cancelado") return MENSAJE_CANCELADO;
  if (turno.estado === "ausente") return MENSAJE_AUSENTE;
  return MENSAJE_NO_EMPEZO;
}

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
    select: { id: true, estado: true, pagoEstado: true, fecha: true, actualizadoEn: true },
  });

  if (!existente) {
    throw new ApiError("Turno no encontrado", 404);
  }

  // La decisión es sePuedeCobrar, la misma que usan las pantallas para
  // ofrecer Cobrar; acá solo se elige cuál de los rechazos explicar.
  if (!sePuedeCobrar(existente, fecha)) {
    throw new ApiError(motivoDelRechazo(existente), 400);
  }

  // Único caso en que el cobro además cierra el turno.
  const cierraElTurno = existente.estado === "programado";

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
        fecha: existente.fecha,
        actualizadoEn: existente.actualizadoEn,
        pagoEstado: "pendiente",
      },
      data: {
        ...(cierraElTurno ? { estado: "realizado" } : {}),
        pagoEstado: "pagado",
        pagoFecha: fecha,
        // La versión debe avanzar incluso si dos operaciones caen en el mismo ms.
        actualizadoEn: new Date(Math.max(Date.now(), existente.actualizadoEn.getTime() + 1)),
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
      await cancelarEnviosDelTurno(tx, turnoId);
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
  actualizadoEn,
}: DescobrarTurnoInput): Promise<Turno> {
  const existente = await prisma.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: { id: true, pagoEstado: true, actualizadoEn: true },
  });

  if (!existente) {
    throw new ApiError("Turno no encontrado", 404);
  }

  if (existente.pagoEstado !== "pagado") {
    throw new ApiError(MENSAJE_NO_COBRADO, 400);
  }

  // La versión viaja desde la pantalla: un pedido demorado no puede borrar
  // otro cobro, aunque el turno haya vuelto a estar pagado con el mismo método.
  const { count } = await prisma.turno.updateMany({
    where: { id: turnoId, organizationId, pagoEstado: "pagado", actualizadoEn },
    data: {
      pagoEstado: "pendiente",
      pagoFecha: null,
      pagoMetodo: null,
      actualizadoEn: new Date(Math.max(Date.now(), existente.actualizadoEn.getTime() + 1)),
    },
  });

  if (count === 0) {
    throw new ApiError("El cobro cambió. Revisá el pago actual antes de deshacerlo.", 409);
  }

  const turno = await prisma.turno.findFirstOrThrow({
    where: { id: turnoId, organizationId },
  });

  return toTurno(turno);
}
