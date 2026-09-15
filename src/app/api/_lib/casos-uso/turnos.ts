// Casos de uso de la agenda: listar turnos, los cobros del mes y editar un
// turno (mover, cambiar duración/modalidad/notas, cambiar de estado).
//
// Vivían dentro de GET /api/turnos, GET /api/turnos/cobros y PATCH
// /api/turnos/[id]. Las rutas ahora solo validan y llaman. Sin request ni
// Response: reciben prisma como parámetro, como el resto de casos-uso/.

import { MENSAJE_NO_REABRIR, MENSAJE_SOLO_PROGRAMADOS } from "@/lib/glosario";
import type { Prisma } from "@prisma/client";

import type { Duracion, EstadoTurno, Modalidad } from "@/lib/constantes-turno";
import type { db } from "@/lib/db";
import { finDeMesMvd, inicioDeMesMvd } from "@/lib/fechas-montevideo";
import { cifrarTurno } from "@/lib/prisma-encryption";
import type { Turno, TurnoConPaciente } from "@/types/domain";

import { toTurno, toTurnoConPaciente } from "../domain";
import { ApiError } from "../responses";
import {
  cancelarEnviosDelTurno,
  programarEnvioDelTurno,
  reprogramarEnvioDelTurno,
  turnoSigueProgramado,
} from "./envios-del-turno";
import {
  assertSinSolapamiento,
  ESTADOS_QUE_OCUPAN,
  tomarLockDeAgenda,
} from "./solapamiento-turnos";

type ClientePrisma = typeof db;

/** Lo que la agenda necesita de cada turno además de la fila. */
const INCLUDE_AGENDA = {
  sesionClinica: { select: { id: true, estado: true } },
  paciente: {
    select: { id: true, nombre: true, apellido: true, telefono: true },
  },
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Lectura
// ────────────────────────────────────────────────────────────────────────────

export interface ListarTurnosInput {
  prisma: ClientePrisma;
  organizationId: string;
  desde: Date;
  hasta: Date;
  pacienteId?: string;
  includeCancelados: boolean;
}

/** Turnos de la organización entre dos instantes, por fecha ascendente. */
export async function listarTurnos({
  prisma,
  organizationId,
  desde,
  hasta,
  pacienteId,
  includeCancelados,
}: ListarTurnosInput): Promise<TurnoConPaciente[]> {
  const where: Prisma.TurnoWhereInput = {
    organizationId,
    fecha: { gte: desde, lte: hasta },
  };
  if (pacienteId) where.pacienteId = pacienteId;
  if (!includeCancelados) where.estado = { not: "cancelado" };

  const turnos = await prisma.turno.findMany({
    where,
    include: INCLUDE_AGENDA,
    orderBy: { fecha: "asc" },
  });

  return turnos.map(toTurnoConPaciente);
}

export interface CobrosDelMesInput {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
}

/**
 * Cobros (turnos pagados) del mes de `ahora`, por pagoFecha descendente.
 *
 * listarTurnos filtra por la fecha del turno; la vista "Cobros del mes"
 * necesita la fecha del PAGO: un turno de abril cobrado en mayo es de mayo.
 */
export async function cobrosDelMes({
  prisma,
  organizationId,
  ahora,
}: CobrosDelMesInput): Promise<TurnoConPaciente[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      organizationId,
      pagoEstado: "pagado",
      pagoFecha: { gte: inicioDeMesMvd(ahora), lte: finDeMesMvd(ahora) },
    },
    include: INCLUDE_AGENDA,
    orderBy: { pagoFecha: "desc" },
  });

  return turnos.map(toTurnoConPaciente);
}

// ────────────────────────────────────────────────────────────────────────────
// Edición
// ────────────────────────────────────────────────────────────────────────────

export interface CambiosTurno {
  fecha?: Date;
  duracion?: Duracion;
  modalidad?: Modalidad;
  notas?: string | null;
  estado?: EstadoTurno;
}

export interface ActualizarTurnoInput {
  prisma: ClientePrisma;
  organizationId: string;
  turnoId: string;
  cambios: CambiosTurno;
  ahora: Date;
}

export { MENSAJE_NO_REABRIR } from "@/lib/glosario";
export { MENSAJE_SOLO_PROGRAMADOS } from "@/lib/glosario";

function ocupa(estado: string): boolean {
  return ESTADOS_QUE_OCUPAN.includes(
    estado as (typeof ESTADOS_QUE_OCUPAN)[number],
  );
}

/**
 * Edita un turno. Un turno de una serie se edita igual que uno suelto: el
 * `serieId` no se toca (sigue sirviendo para "cancelar el resto desde acá")
 * y mover uno no mueve a los demás.
 */
export async function actualizarTurno({
  prisma,
  organizationId,
  turnoId,
  cambios,
  ahora,
}: ActualizarTurnoInput): Promise<Turno> {
  const cambiaDatos =
    cambios.fecha !== undefined ||
    cambios.duracion !== undefined ||
    cambios.modalidad !== undefined ||
    cambios.notas !== undefined;

  const turno = await prisma.$transaction(async (tx) => {
    // El lock PRIMERO, y recién después releer el turno (Codex P1 sobre el
    // PR original).
    //
    // Componer el intervalo final con la fila que se leyó antes del lock es
    // leer datos viejos: dos PATCH simultáneos sobre el MISMO turno que
    // tocan campos distintos se pisan. Uno mueve un turno de 10:00/50 a las
    // 11:00 y el otro le cambia la duración a 90: el segundo espera el
    // lock, valida 10:00-11:30 (la fecha vieja), pasa, y su update parcial
    // —que no manda `fecha`— conserva las 11:00 recién commiteadas. El
    // turno termina en 11:00-12:30, un intervalo que nadie validó.
    await tomarLockDeAgenda(tx, organizationId);

    const actual = await tx.turno.findFirst({
      where: { id: turnoId, organizationId },
    });

    if (!actual) {
      throw new ApiError("Turno no encontrado", 404);
    }

    // Las dos guardas de estado también miran la fila releída: si se
    // decidieran con la lectura previa al lock, un turno cancelado en el
    // medio se podría reabrir igual.
    if (actual.estado === "cancelado" && cambios.estado !== undefined) {
      throw new ApiError(MENSAJE_NO_REABRIR, 400);
    }

    if (cambiaDatos && actual.estado !== "programado") {
      throw new ApiError(MENSAJE_SOLO_PROGRAMADOS, 400);
    }

    // Un body vacío no escribe nada: updateMany con todo undefined no toca
    // filas y devolvería count 0, que abajo se leería como "no existe".
    if (!cambiaDatos && cambios.estado === undefined) {
      return actual;
    }

    // El intervalo en el que va a quedar el turno: lo que se manda, o lo
    // que tiene AHORA.
    const fechaFinal = cambios.fecha ?? actual.fecha;
    const duracionFinal = cambios.duracion ?? actual.duracion;
    const estadoFinal = cambios.estado ?? actual.estado;

    // Sólo se comprueba el solapamiento cuando esta edición puede CREARLO:
    // se movió el intervalo de un turno que ocupa, o el turno pasó de no
    // ocupar a ocupar (ausente → programado). No se revalida en cada
    // edición: un turno que ya estaba solapado no puede quedar con las
    // notas sin poder editarse para siempre.
    const movioElIntervalo =
      fechaFinal.getTime() !== actual.fecha.getTime() ||
      duracionFinal !== actual.duracion;
    const pasaAOcupar = !ocupa(actual.estado) && ocupa(estadoFinal);

    if (ocupa(estadoFinal) && (movioElIntervalo || pasaAOcupar)) {
      await assertSinSolapamiento({
        prisma: tx,
        organizationId,
        intervalo: { inicio: fechaFinal, duracionMin: duracionFinal },
        // Sin esto, mover un turno cinco minutos lo haría chocar consigo
        // mismo.
        excluirTurnoId: turnoId,
      });
    }

    // La nota va cifrada, atada a ESTA fila (anexo de docs/esquema.md:
    // cifrarTurno del área 3); `undefined` no la toca. El `id` que devuelve
    // cifrarTurno es para los create: acá el WHERE ya lo tiene.
    const { id: _id, ...notasCifradas } =
      cambios.notas === undefined
        ? { id: turnoId }
        : cifrarTurno(turnoId, { notas: cambios.notas });
    void _id;

    // La organización va en el WHERE de la escritura y no sólo en la
    // lectura: `update({ where: { id } })` escribe la fila aunque sea de
    // otra organización. Con updateMany + count la pertenencia es parte de
    // la operación.
    const { count } = await tx.turno.updateMany({
      where: { id: turnoId, organizationId },
      data: {
        fecha: cambios.fecha,
        duracion: cambios.duracion,
        modalidad: cambios.modalidad,
        estado: cambios.estado,
        ...notasCifradas,
      },
    });

    if (count === 0) {
      throw new ApiError("Turno no encontrado", 404);
    }

    const updated = await tx.turno.findUniqueOrThrow({ where: { id: turnoId } });

    // Un turno que dejó de estar programado —realizado, ausente o
    // cancelado— no avisa nada. La regla vive en
    // casos-uso/envios-del-turno.ts, no acá.
    if (!turnoSigueProgramado(updated.estado)) {
      await cancelarEnviosDelTurno(tx, turnoId);
      return updated;
    }

    // Llegados acá el turno ESTÁ programado. Dos motivos para rehacer el
    // recordatorio: la reprogramación de siempre, y un turno que venía
    // cerrado (realizado o ausente) y vuelve a "programado": el cierre apagó
    // sus recordatorios y sin esta rama no volvería a avisar nunca.
    const fechaCambio =
      cambios.fecha !== undefined &&
      updated.fecha.getTime() !== actual.fecha.getTime();
    const reabierto =
      !turnoSigueProgramado(actual.estado) &&
      turnoSigueProgramado(updated.estado);

    if (fechaCambio) {
      // Se apaga lo pendiente de la fecha vieja y se programa el aviso de la
      // nueva (o un cambio de horario, si el de la fecha vieja ya salió).
      await reprogramarEnvioDelTurno(tx, {
        turnoId: updated.id,
        organizationId,
        pacienteId: updated.pacienteId,
        fechaTurno: updated.fecha,
        fechaTurnoPrevia: actual.fecha,
        ahora,
      });
    } else if (reabierto) {
      // Revive el envío que el cierre había cancelado.
      await programarEnvioDelTurno(tx, {
        turnoId: updated.id,
        organizationId,
        pacienteId: updated.pacienteId,
        fechaTurno: updated.fecha,
        ahora,
      });
    }

    return updated;
  });

  return toTurno(turno);
}
