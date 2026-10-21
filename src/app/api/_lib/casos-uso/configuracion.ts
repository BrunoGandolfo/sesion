// Casos de uso de "Tu consultorio": leer y editar la configuración de la
// organización. Vivían dentro de GET/PATCH /api/config.
//
// Cada cambio queda en eventos_auditoria (configuracion.editar): qué campos
// cambiaron y quién; del canal y del modo del recordatorio, también el antes
// y el después. Las plantillas y los datos de "Vos" van sólo por nombre: el
// texto no entra al registro. Guardar lo mismo (el autoguardado lo hace) no
// deja evento.
//
// `horasAnticipacion` no existe más (ni en el schema Zod ni en la base): el
// recordatorio se guarda como MOMENTO (`recordatorioModo`, ver
// src/lib/recordatorios-programacion.ts). Como zod ignora las claves que el
// objeto no declara, un cliente viejo que lo mande no rompe: se descarta.

import type { Prisma } from "@prisma/client";

import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import type { Configuracion } from "@/types/domain";

import { auditar } from "../auditoria";
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
  | "templateCobro"
  | "orientacionTeorica"
  | "canalRecordatorio"
>;

export interface ActualizarConfiguracionInput {
  prisma: ClientePrisma;
  organizationId: string;
  /** Quién guardó: va al evento de auditoría. */
  usuarioId: string;
  cambios: CambiosConfiguracion;
}

/** Los campos cuyo valor entra al evento: enums, sin texto de ella. */
const CON_VALOR = ["canalRecordatorio", "recordatorioModo"] as const;

export async function actualizarConfiguracion({
  prisma,
  organizationId,
  usuarioId,
  cambios,
}: ActualizarConfiguracionInput): Promise<Configuracion> {
  // Un body sin ningún campo conocido (por ejemplo, sólo `horasAnticipacion`
  // de un cliente viejo) no escribe nada: updateMany con `data: {}` no toca
  // filas y devolvería count 0, que acá se leería como "no existe".
  const hayCambios = Object.values(cambios).some((v) => v !== undefined);

  const configuracion = await prisma.$transaction(async (tx) => {
    // La organización es la clave única de la fila: el WHERE ya es la
    // pertenencia. FOR UPDATE: dos guardados a la vez no leen el mismo
    // "antes".
    if (hayCambios) {
      await tx.$queryRaw`SELECT 1 FROM configuraciones WHERE organization_id = ${organizationId} FOR UPDATE`;
    }
    const antes = await tx.configuracion.findUnique({ where: { organizationId } });
    if (!antes) throw new ApiError("Configuración no encontrada", 404);
    if (!hayCambios) return antes;

    const despues = await tx.configuracion.update({ where: { organizationId }, data: cambios });
    const campos = (Object.keys(cambios) as (keyof CambiosConfiguracion)[])
      .filter((campo) => cambios[campo] !== undefined && antes[campo] !== despues[campo])
      .sort();
    if (campos.length > 0) {
      // Planos: detalleSeguro sólo deja pasar primitivos.
      const valores = Object.fromEntries(
        CON_VALOR.filter((campo) => campos.includes(campo)).flatMap((campo) => [
          [`${campo}Antes`, antes[campo]],
          [`${campo}Despues`, despues[campo]],
        ]),
      );
      await auditar(tx, {
        organizationId,
        actorTipo: "usuario",
        actorId: usuarioId,
        entidad: "configuracion",
        entidadId: despues.id,
        accion: ACCIONES.configuracion.editar,
        detalle: { campos, ...valores },
      });
    }
    return despues;
  });

  return toConfiguracion(configuracion);
}
