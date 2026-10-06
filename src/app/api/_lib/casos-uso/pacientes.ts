// Casos de uso de la ficha: listar, crear, leer y editar pacientes.
//
// Crear y editar dejan su evento de auditoría (paciente.crear,
// paciente.editar) en la MISMA transacción que el acto. Archivar
// (`activo: false`) no es sólo esconderla de la lista: apaga sus SMS
// pendientes y deja paciente.archivar, los tres juntos. Si el evento no se
// puede escribir, el acto no queda hecho. Volver a activarla no revive los
// SMS apagados (`cancelado` es terminal).
//
// Vivían dentro de GET/POST /api/pacientes y GET/PATCH /api/pacientes/[id].
// Las rutas ahora solo validan y llaman. Sin request ni Response.
//
// Las notas privadas van cifradas, atadas al id de la fila (por eso el id
// nace acá con crypto.randomUUID). La firma es la del anexo de
// docs/esquema.md: campo lógico `notas` de `pacientes.notas_encrypted`,
// escrito con `cifrarPaciente(id, { notas })` de @/lib/prisma-encryption
// (área 3) y leído en claro por la extensión.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import { cifrarPaciente } from "@/lib/prisma-encryption";
import type { Paciente, PacienteConDeuda, Turno } from "@/types/domain";

import { auditar } from "../auditoria";
import { toPaciente, toPacienteConDeuda, toTurno } from "../domain";
import { MENSAJE_PACIENTE_NO_ENCONTRADO } from "../pacientes";
import { ApiError } from "../responses";
import { cancelarEnviosDeLaPaciente, MOTIVO_PACIENTE_ARCHIVADA } from "./envios-del-turno";
import { ACCIONES } from "@/lib/auditoria-acciones";

type ClientePrisma = typeof db;

// ────────────────────────────────────────────────────────────────────────────
// Lectura
// ────────────────────────────────────────────────────────────────────────────

export interface ListarPacientesInput {
  prisma: ClientePrisma;
  organizationId: string;
  activo: boolean;
  /** Búsqueda por nombre o apellido, sin distinguir mayúsculas. */
  q?: string;
}

/** Pacientes de la organización con su deuda, por apellido y nombre. */
export async function listarPacientes({
  prisma,
  organizationId,
  activo,
  q,
}: ListarPacientesInput): Promise<PacienteConDeuda[]> {
  const where: Prisma.PacienteWhereInput = { organizationId, activo };
  if (q) {
    where.OR = [
      { nombre: { contains: q, mode: "insensitive" } },
      { apellido: { contains: q, mode: "insensitive" } },
    ];
  }

  const pacientes = await prisma.paciente.findMany({
    where,
    include: {
      turnos: {
        select: { fecha: true, estado: true, pagoEstado: true, tarifaCobrada: true },
      },
    },
    orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
  });

  return pacientes.map(toPacienteConDeuda);
}

export interface ObtenerPacienteInput {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
}

/** La ficha: el paciente con su deuda y todos sus turnos, del más reciente
 *  al más viejo. 404 si no es de esta organización. */
export async function obtenerPaciente({
  prisma,
  organizationId,
  pacienteId,
}: ObtenerPacienteInput): Promise<{ paciente: PacienteConDeuda; turnos: Turno[] }> {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
    include: { turnos: { orderBy: { fecha: "desc" } } },
  });

  if (!paciente) {
    throw new ApiError(MENSAJE_PACIENTE_NO_ENCONTRADO, 404);
  }

  return {
    paciente: toPacienteConDeuda(paciente),
    turnos: paciente.turnos.map(toTurno),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Escritura
// ────────────────────────────────────────────────────────────────────────────

export interface DatosPaciente {
  nombre: string;
  apellido: string;
  /** Ya normalizado a E.164 por el schema de la ruta. */
  telefono: string;
  tarifa: number;
  notas: string | null;
}

export interface CrearPacienteInput {
  prisma: ClientePrisma;
  organizationId: string;
  datos: DatosPaciente;
  /** Quién la crea, para paciente.crear. */
  usuarioId: string;
}

export async function crearPaciente({
  prisma,
  organizationId,
  datos,
  usuarioId,
}: CrearPacienteInput): Promise<Paciente> {
  const id = crypto.randomUUID();
  const fila = await prisma.$transaction(async (tx) => {
    const creada = await tx.paciente.create({
      data: {
        nombre: datos.nombre,
        apellido: datos.apellido,
        telefono: datos.telefono,
        tarifa: datos.tarifa,
        organizationId,
        ...cifrarPaciente(id, { notas: datos.notas }),
      },
    });
    // Sólo el id: ni nombre ni teléfono ni notas entran al rastro.
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.paciente.crear,
      entidad: "paciente",
      entidadId: creada.id,
    });
    return creada;
  });

  // Las notas recién escritas: no hace falta descifrar lo que se acaba de
  // cifrar.
  return toPaciente({ ...fila, notas: datos.notas });
}

/** Lo que contesta PATCH /api/pacientes/[id]: la paciente y cuántos turnos
 *  futuros tomaron la tarifa nueva. Contrato con las pantallas. */
export type PacienteActualizado = Paciente & { turnosActualizados: number };

export interface ActualizarPacienteInput {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Los campos ausentes no se tocan. `activo` es el alta y la baja lógica. */
  cambios: Partial<DatosPaciente> & { activo?: boolean };
  /** Quién edita o archiva, para el evento de auditoría. */
  usuarioId: string;
  /** Momento del acto. Inyectado para que el caso sea determinista. */
  ahora?: Date;
}

/** Los campos de la ficha que se comparan con lo guardado para saber qué
 *  cambió. `notas` va cifrada: si vino, cuenta como cambiada. */
const CAMPOS_COMPARABLES = ["nombre", "apellido", "telefono", "tarifa", "activo"] as const;

/**
 * Edita la ficha, en UNA transacción con su rastro:
 *
 *   - archivar (`activo: false` sobre una activa) apaga sus SMS pendientes y
 *     deja paciente.archivar. Si ya estaba archivada igual barre lo que haya
 *     quedado pendiente, y sólo audita si apagó algo.
 *   - cualquier otro campo que cambie deja paciente.editar con los NOMBRES de
 *     los campos (nunca los valores: nombre, teléfono y notas son datos de la
 *     paciente).
 *
 *   - si cambia la tarifa, la nueva alcanza a sus turnos `programado` con
 *     fecha futura que no estén cobrados (`tarifaCobrada`). Nunca a los
 *     pasados, realizados, ausentes, cancelados ni cobrados: lo que ya pasó
 *     o ya se cobró se cobró a la tarifa de su día. El 30-sep Mariana bajó
 *     dos pacientes de 2.600 a 1.400 y les quedaron 6 turnos futuros a 2.600.
 *
 * La fila se bloquea antes de leerla: lo que se compara para decidir qué
 * cambió es lo que está guardado, no lo que leyó otro pedido en paralelo.
 *
 * Devuelve la paciente y `turnosActualizados` (0 si la tarifa no cambió):
 * es lo que el PATCH contesta, para que la pantalla pueda decirlo.
 */
export async function actualizarPaciente({
  prisma,
  organizationId,
  pacienteId,
  cambios,
  usuarioId,
  ahora = new Date(),
}: ActualizarPacienteInput): Promise<PacienteActualizado> {
  const { notas, ...resto } = cambios;
  // El `id` que devuelve cifrarPaciente es para los create: acá el WHERE ya
  // lo tiene. `undefined` no toca la nota.
  const { id: _id, ...notasCifradas } =
    notas === undefined ? { id: pacienteId } : cifrarPaciente(pacienteId, { notas });
  void _id;

  const data = { ...resto, ...notasCifradas };
  const hayCambios = Object.values(data).some((v) => v !== undefined);

  const turnosActualizados = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pacientes
      WHERE id = ${pacienteId} AND organization_id = ${organizationId} FOR UPDATE`;
    const actual = await tx.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { nombre: true, apellido: true, telefono: true, tarifa: true, activo: true },
    });
    if (!actual) throw new ApiError(MENSAJE_PACIENTE_NO_ENCONTRADO, 404);

    if (hayCambios) {
      // La organización va en el WHERE de la escritura, no sólo en la lectura:
      // `update({ where: { id } })` escribe la fila aunque sea de otra.
      await tx.paciente.updateMany({ where: { id: pacienteId, organizationId }, data });
    }

    const cambiaTarifa = cambios.tarifa !== undefined && cambios.tarifa !== actual.tarifa;
    const { count: turnosActualizados } = cambiaTarifa
      ? await tx.turno.updateMany({
          where: {
            organizationId,
            pacienteId,
            estado: "programado",
            fecha: { gt: ahora },
            pagoEstado: "pendiente",
          },
          data: { tarifaCobrada: cambios.tarifa },
        })
      : { count: 0 };

    const auditarComo = (
      accion: typeof ACCIONES.paciente.archivar | typeof ACCIONES.paciente.editar,
      detalle: Record<string, unknown>,
    ) =>
      auditar(tx, {
        organizationId,
        actorTipo: "usuario",
        actorId: usuarioId,
        entidad: "paciente",
        entidadId: pacienteId,
        accion,
        creadoEn: ahora,
        detalle,
      });

    const archiva = cambios.activo === false;
    if (archiva) {
      // Se apaga aunque ya estuviera archivada: limpia lo que haya quedado
      // pendiente de antes de que archivar cancelara los SMS.
      const enviosCancelados = await cancelarEnviosDeLaPaciente(
        tx,
        { organizationId, pacienteId },
        MOTIVO_PACIENTE_ARCHIVADA,
        ahora,
      );
      if (actual.activo || enviosCancelados > 0) {
        await auditarComo(ACCIONES.paciente.archivar, { enviosCancelados, yaEstabaArchivada: !actual.activo });
      }
    }

    const campos = [
      ...CAMPOS_COMPARABLES.filter(
        (campo) => cambios[campo] !== undefined && cambios[campo] !== actual[campo] && !(archiva && campo === "activo"),
      ),
      ...(notas !== undefined ? ["notas"] : []),
    ];
    if (campos.length > 0) {
      await auditarComo(ACCIONES.paciente.editar, { campos, ...(cambiaTarifa ? { turnosActualizados } : {}) });
    }
    return turnosActualizados;
  });

  // Un body vacío no escribe nada: se lee y se devuelve tal cual, con la
  // organización en el WHERE.
  const fila = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
  });

  if (!fila) {
    throw new ApiError(MENSAJE_PACIENTE_NO_ENCONTRADO, 404);
  }

  return { ...toPaciente(fila), turnosActualizados };
}
