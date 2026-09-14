// Casos de uso de "Tu consultorio": leer y editar la configuración de la
// organización. Vivían dentro de GET/PATCH /api/config.
//
// `horasAnticipacion` no existe más (ni en el schema Zod ni en la base): el
// recordatorio se guarda como MOMENTO (`recordatorioModo`, ver
// src/lib/recordatorios-programacion.ts). Como zod ignora las claves que el
// objeto no declara, un cliente viejo que lo mande no rompe: se descarta.

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import type { Configuracion } from "@/types/domain";

import { toConfiguracion } from "../domain";
import { ApiError } from "../responses";

type ClientePrisma = typeof db;

export interface ObtenerConfiguracionInput {
  prisma: ClientePrisma;
  organizationId: string;
}

export async function obtenerConfiguracion({
  prisma,
  organizationId,
}: ObtenerConfiguracionInput): Promise<Configuracion> {
  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId },
  });

  if (!configuracion) {
    throw new ApiError("Configuración no encontrada", 404);
  }

  return toConfiguracion(configuracion);
}

/** Lo que se puede cambiar: los campos ausentes no se tocan. */
export type CambiosConfiguracion = Pick<
  Prisma.ConfiguracionUpdateManyMutationInput,
  | "nombreProfesional"
  | "direccion"
  | "whatsappOrigen"
  | "tarifaDefault"
  | "recordatorioModo"
  | "templateRecordatorio"
  | "orientacionTeorica"
>;

export interface ActualizarConfiguracionInput {
  prisma: ClientePrisma;
  organizationId: string;
  cambios: CambiosConfiguracion;
}

export async function actualizarConfiguracion({
  prisma,
  organizationId,
  cambios,
}: ActualizarConfiguracionInput): Promise<Configuracion> {
  // Un body sin ningún campo conocido (por ejemplo, sólo `horasAnticipacion`
  // de un cliente viejo) no escribe nada: updateMany con `data: {}` no toca
  // filas y devolvería count 0, que acá se leería como "no existe".
  const hayCambios = Object.values(cambios).some((v) => v !== undefined);

  if (hayCambios) {
    // La organización es la clave única de la fila: el WHERE ya es la
    // pertenencia.
    await prisma.configuracion.updateMany({
      where: { organizationId },
      data: cambios,
    });
  }

  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId },
  });

  if (!configuracion) {
    throw new ApiError("Configuración no encontrada", 404);
  }

  return toConfiguracion(configuracion);
}
