// Casos de uso de la ficha: listar, crear, leer y editar pacientes.
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

import { toPacienteConDeuda, toTurno } from "../domain";
import { ApiError } from "../responses";

type ClientePrisma = typeof db;

/** Lo que la API devuelve de un paciente: la fila sin el blob cifrado. */
function toPaciente(fila: {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  tarifa: number;
  notas: string | null;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
  organizationId: string;
}): Paciente {
  return {
    id: fila.id,
    nombre: fila.nombre,
    apellido: fila.apellido,
    telefono: fila.telefono,
    tarifa: fila.tarifa,
    notas: fila.notas,
    activo: fila.activo,
    creadoEn: fila.creadoEn,
    actualizadoEn: fila.actualizadoEn,
    organizationId: fila.organizationId,
  };
}

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
    throw new ApiError("Paciente no encontrado", 404);
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
}

export async function crearPaciente({
  prisma,
  organizationId,
  datos,
}: CrearPacienteInput): Promise<Paciente> {
  const id = crypto.randomUUID();
  const fila = await prisma.paciente.create({
    data: {
      nombre: datos.nombre,
      apellido: datos.apellido,
      telefono: datos.telefono,
      tarifa: datos.tarifa,
      organizationId,
      ...cifrarPaciente(id, { notas: datos.notas }),
    },
  });

  // Las notas recién escritas: no hace falta descifrar lo que se acaba de
  // cifrar.
  return toPaciente({ ...fila, notas: datos.notas });
}

export interface ActualizarPacienteInput {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Los campos ausentes no se tocan. `activo` es el alta y la baja lógica. */
  cambios: Partial<DatosPaciente> & { activo?: boolean };
}

export async function actualizarPaciente({
  prisma,
  organizationId,
  pacienteId,
  cambios,
}: ActualizarPacienteInput): Promise<Paciente> {
  const { notas, ...resto } = cambios;
  // El `id` que devuelve cifrarPaciente es para los create: acá el WHERE ya
  // lo tiene. `undefined` no toca la nota.
  const { id: _id, ...notasCifradas } =
    notas === undefined ? { id: pacienteId } : cifrarPaciente(pacienteId, { notas });
  void _id;

  const data = { ...resto, ...notasCifradas };
  const hayCambios = Object.values(data).some((v) => v !== undefined);

  if (hayCambios) {
    // La organización va en el WHERE de la escritura, no sólo en un chequeo
    // previo: `update({ where: { id } })` escribe la fila aunque sea de otra
    // organización, y entre el chequeo y la escritura hay una ventana. Con
    // updateMany + count la pertenencia es parte de la operación.
    const { count } = await prisma.paciente.updateMany({
      where: { id: pacienteId, organizationId },
      data,
    });

    if (count === 0) {
      throw new ApiError("Paciente no encontrado", 404);
    }
  }

  // Un body vacío no escribe nada (updateMany con data: {} no toca filas y
  // devolvería count 0): se lee y se devuelve tal cual, con la organización
  // en el WHERE.
  const fila = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
  });

  if (!fila) {
    throw new ApiError("Paciente no encontrado", 404);
  }

  return toPaciente(fila);
}
