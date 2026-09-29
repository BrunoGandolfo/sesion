// Casos de uso de la agenda: listar turnos, los cobros del mes y editar un
// turno (mover, cambiar duración/modalidad/notas, cambiar de estado).
//
// Vivían dentro de GET /api/turnos, GET /api/turnos/cobros y PATCH
// /api/turnos/[id]. Las rutas ahora solo validan y llaman. Sin request ni
// Response: reciben prisma como parámetro, como el resto de casos-uso/.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import { cifrarTurno } from "@/lib/prisma-encryption";
import type { Turno, TurnoConPaciente } from "@/types/domain";

import {
  cobradoEnMes,
  decidirEdicionTurno,
  efectoEnvioDeEdicion,
  toTurno,
  toTurnoConPaciente,
  type CambiosTurno,
} from "../domain";
import { ApiError } from "../responses";
import {
  cancelarEnviosDelTurno,
  programarEnvioDelTurno,
  reprogramarEnvioDelTurno,
} from "./envios-del-turno";
import { assertSinSolapamiento, tomarLockDeAgenda } from "./solapamiento-turnos";

type ClientePrisma = typeof db;

/** Lo que la agenda necesita de cada turno además de la fila. */
const INCLUDE_AGENDA = {
  sesionClinica: { select: { id: true, estado: true, actualizadaEn: true } },
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
  /** CUALQUIER instante del mes que se quiere leer, no necesariamente hoy.
   *  Se llamaba `ahora` y eso escondía que sirve para cualquier mes: es la
   *  lectura de detalle que usa Finanzas al tocar una barra. */
  enElMesDe: Date;
}

/**
 * Cobros (turnos pagados) del mes de `enElMesDe`, por pagoFecha descendente.
 *
 * listarTurnos filtra por la fecha del turno; la vista "Cobros del mes"
 * necesita la fecha del PAGO: un turno de abril cobrado en mayo es de mayo.
 */
export async function cobrosDelMes({
  prisma,
  organizationId,
  enElMesDe,
}: CobrosDelMesInput): Promise<TurnoConPaciente[]> {
  const turnos = await prisma.turno.findMany({
    where: cobradoEnMes(organizationId, enElMesDe),
    include: INCLUDE_AGENDA,
    orderBy: { pagoFecha: "desc" },
  });

  return turnos.map(toTurnoConPaciente);
}

// ────────────────────────────────────────────────────────────────────────────
// Edición
// ────────────────────────────────────────────────────────────────────────────

export type { CambiosTurno } from "../domain";

export interface ActualizarTurnoInput {
  prisma: ClientePrisma;
  organizationId: string;
  turnoId: string;
  cambios: CambiosTurno;
  ahora: Date;
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

    // Qué se puede y qué hay que hacer lo decide domain.ts, con la fila
    // releída bajo el lock. Acá solo se aplica.
    const decision = decidirEdicionTurno(actual, cambios);
    if (decision.tipo === "rechazo") throw new ApiError(decision.mensaje, 400);
    if (decision.tipo === "sinCambios") return actual;

    if (decision.verificarSolapamiento) {
      await assertSinSolapamiento({
        prisma: tx,
        organizationId,
        intervalo: decision.verificarSolapamiento,
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

    // El aviso sigue lo que quedó ESCRITO, no lo que se previó: cobrar no
    // toma el lock de agenda y pudo cerrar el turno en el medio. Con la
    // fila de la base, la misma regla (efectoEnvioDeEdicion) da lo mismo
    // que la decisión salvo en esa carrera.
    const efecto = efectoEnvioDeEdicion(actual, updated, cambios.fecha !== undefined);
    const turnoDelAviso = {
      turnoId: updated.id,
      organizationId,
      pacienteId: updated.pacienteId,
      fechaTurno: updated.fecha,
      ahora,
    };
    if (efecto === "cancelar") {
      // Un turno que dejó de estar programado —realizado, ausente o
      // cancelado— no avisa nada.
      await cancelarEnviosDelTurno(tx, turnoId);
    } else if (efecto === "reprogramar") {
      // Se apaga lo pendiente de la fecha vieja y se programa el aviso de la
      // nueva (o un cambio de horario, si el de la fecha vieja ya salió).
      await reprogramarEnvioDelTurno(tx, { ...turnoDelAviso, fechaTurnoPrevia: actual.fecha });
    } else if (efecto === "revivir") {
      // Venía cerrado (realizado o ausente) y vuelve a "programado": el
      // cierre apagó sus recordatorios y sin esto no volvería a avisar.
      await programarEnvioDelTurno(tx, turnoDelAviso);
    }

    return updated;
  });

  return toTurno(turno);
}
