// Los estados de una versión del Recorrido y qué operación los mueve.
//
// Una versión nace `aplicada` (la escribió ella), `propuesta` (la IA, sobre el
// Recorrido vigente) o `desactualizada` (la IA, sobre una versión que ya no es
// la vigente). Desde ahí sólo se mueve por estas operaciones; los casos de
// uso de src/app/api/_lib/casos-uso/hilo/ preguntan acá en vez de escribir
// su propia lista. Es la misma idea que sesion-clinica/estados.ts, en chico.
//
// Módulo puro: sin Prisma ni Node.

import type { ResumenVersionHilo } from "./contenido";

export type EstadoVersionHilo = ResumenVersionHilo["estado"];

/** Enum `estado_version_hilo` de Postgres; hilo-integracion lo compara. */
export const ESTADOS_VERSION_HILO: ReadonlyArray<EstadoVersionHilo> = [
  "aplicada",
  "propuesta",
  "desactualizada",
  "rechazada",
];

interface OperacionVersion {
  desde: ReadonlyArray<EstadoVersionHilo>;
  hacia: EstadoVersionHilo;
}

export const OPERACIONES_VERSION = {
  /** Ella acepta la propuesta (tal cual o editada). */
  aceptar: { desde: ["propuesta"], hacia: "aplicada" },
  /** Ella la descarta: una propuesta, o una que ya quedó vieja. */
  rechazar: { desde: ["propuesta", "desactualizada"], hacia: "rechazada" },
  /** Otra versión pasó a ser la vigente: la propuesta abierta queda vieja. */
  desactualizar: { desde: ["propuesta"], hacia: "desactualizada" },
  /** Pedir otra propuesta para la misma sesión: la anterior se da por rechazada. */
  regenerar: { desde: ["desactualizada", "rechazada"], hacia: "rechazada" },
} as const satisfies Record<string, OperacionVersion>;

export type OperacionVersionHilo = keyof typeof OPERACIONES_VERSION;

/** ¿Vale la operación sobre una versión en `estado`? */
export function puedeVersion(op: OperacionVersionHilo, estado: string): boolean {
  return (OPERACIONES_VERSION[op].desde as ReadonlyArray<string>).includes(estado);
}

/** El estado con que nace la propuesta de la IA: `propuesta` si se escribió
 *  sobre el Recorrido vigente, `desactualizada` si mientras tanto cambió. */
export function estadoDePropuestaNueva(
  basadaEnVersion: number,
  vigente: number,
): "propuesta" | "desactualizada" {
  return basadaEnVersion === vigente ? "propuesta" : "desactualizada";
}
