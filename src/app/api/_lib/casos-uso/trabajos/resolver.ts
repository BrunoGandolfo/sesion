// Resultado de un trabajo durable: éxito → `hecho`; fallo → `pendiente`
// con backoff, o `fallido` al tope. Una sola implementación para los dos
// consumidores.
//
// La escritura va condicionada a `estado = en_curso AND intentos = <los del
// claim>`: un resultado que llega después de que el lease venció y otro
// consumidor volvió a reclamar el trabajo no pisa nada (count = 0 → 409).

import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";

import { ApiError } from "../../responses";

import { agotado, backoffTrabajoMs, describirError } from "./politica";

type ClienteTrabajos = Pick<typeof db, "trabajo">;

export type ResultadoEjecucion =
  | { ok: true; uso?: unknown }
  | { ok: false; error: unknown; uso?: unknown };

export interface ResolverTrabajoInput {
  prisma: ClienteTrabajos;
  trabajo: { id: string; tipo: Prisma.TrabajoUncheckedCreateInput["tipo"]; intentos: number };
  resultado: ResultadoEjecucion;
  ahora: Date;
}

export type EstadoResuelto =
  | { estado: "hecho" }
  | { estado: "pendiente"; proximoIntentoEn: Date }
  | { estado: "fallido" };

/** Qué queda del trabajo tras este resultado, sin tocar la base. */
export function decidirResolucion(
  trabajo: { tipo: Prisma.TrabajoUncheckedCreateInput["tipo"]; intentos: number },
  resultado: ResultadoEjecucion,
  ahora: Date,
): EstadoResuelto {
  if (resultado.ok) return { estado: "hecho" };
  if (agotado(trabajo.tipo, trabajo.intentos)) return { estado: "fallido" };
  return {
    estado: "pendiente",
    proximoIntentoEn: new Date(
      ahora.getTime() + backoffTrabajoMs(trabajo.tipo, trabajo.intentos),
    ),
  };
}

export async function resolverTrabajo({
  prisma,
  trabajo,
  resultado,
  ahora,
}: ResolverTrabajoInput): Promise<EstadoResuelto> {
  const resolucion = decidirResolucion(trabajo, resultado, ahora);
  const uso =
    resultado.uso === undefined
      ? undefined
      : (resultado.uso as Prisma.InputJsonValue);

  const { count } = await prisma.trabajo.updateMany({
    where: { id: trabajo.id, estado: "en_curso", intentos: trabajo.intentos },
    data: {
      estado: resolucion.estado,
      leaseVenceEn: null,
      ticketHash: null,
      ...(uso !== undefined ? { uso } : {}),
      ...(resolucion.estado === "hecho"
        ? { hechoEn: ahora, ultimoError: null }
        : { ultimoError: describirError((resultado as { error: unknown }).error) }),
      ...(resolucion.estado === "pendiente"
        ? { proximoIntentoEn: resolucion.proximoIntentoEn }
        : {}),
    },
  });
  if (count === 0) {
    throw new ApiError(
      "El trabajo ya no está reclamado con este intento; resultado ignorado",
      409,
    );
  }
  return resolucion;
}
