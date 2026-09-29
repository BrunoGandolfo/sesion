// Qué tiene que confirmar la profesional antes de aprobar una nota.
//
// Una sola regla para la pantalla y el servidor (forense 01, H1; decisión del
// dueño D1): la pantalla dibuja una casilla por cada cosa que devuelve
// confirmacionesParaAprobar, y POST /aprobar rechaza con 400 si falta
// cualquiera de ellas. Antes el servidor exigía menos que la pantalla (no
// miraba el nivel `bajo` ni los flags), y un cliente viejo o una llamada
// directa aprobaba sin confirmar.
//
// Módulo puro: sin Prisma ni Node. Lo importa código de cliente.

import { flagsActivos, normalizarRiesgo } from "./normalizar";
import type { DatosEstructurados, FlagRiesgo } from "./schema";

/** Clave de la casilla de la señal graduada (riesgoDetectado). Las de los
 *  flags son los nombres de los flags, que no chocan con estas dos. */
export const CLAVE_RIESGO_GRADUADO = "riesgoGraduado";
/** Clave de la casilla "Leí las menciones". */
export const CLAVE_MENCIONES = "menciones-lexicas";

type DatosDeRiesgo = Pick<DatosEstructurados, "riesgoDetectado" | "flagsRiesgo" | "riesgoLexico">;

export interface ConfirmacionesParaAprobar {
  /** Hay un nivel de riesgo graduado distinto de `ninguno` (bajo incluido). */
  riesgoGraduado: boolean;
  /** Una confirmación por cada flag activo, en el orden del contrato. */
  flags: FlagRiesgo[];
  /** Hay menciones léxicas y el modelo no graduó moderado ni alto: ahí las
   *  menciones son la única señal y piden su propia casilla. */
  menciones: boolean;
}

export function confirmacionesParaAprobar(
  datos: Partial<DatosDeRiesgo> | null | undefined,
): ConfirmacionesParaAprobar {
  const nivel = normalizarRiesgo(datos?.riesgoDetectado).nivel;
  const hayMenciones = (datos?.riesgoLexico?.coincidencias.length ?? 0) > 0;
  return {
    riesgoGraduado: nivel !== "ninguno",
    flags: flagsActivos(datos?.flagsRiesgo),
    menciones: hayMenciones && nivel !== "moderado" && nivel !== "alto",
  };
}

/** Las claves de las casillas que la pantalla dibuja, en el orden en que las
 *  dibuja: flags, señal graduada, menciones. */
export function clavesDeConfirmacion(c: ConfirmacionesParaAprobar): string[] {
  return [
    ...c.flags,
    ...(c.riesgoGraduado ? [CLAVE_RIESGO_GRADUADO] : []),
    ...(c.menciones ? [CLAVE_MENCIONES] : []),
  ];
}

/** Lo que el cliente declara en el cuerpo de POST /aprobar. */
export interface ConfirmacionesDadas {
  confirmoRiesgo?: boolean;
  confirmoFlags?: ReadonlyArray<string>;
  confirmoMenciones?: boolean;
}

/** El cuerpo que corresponde a las casillas marcadas: lo que la pantalla
 *  manda. Solo declara lo que la nota exige y ella marcó. */
export function confirmacionesDeCasillas(
  exigidas: ConfirmacionesParaAprobar,
  marcadas: ReadonlySet<string>,
): ConfirmacionesDadas {
  const flags = exigidas.flags.filter((flag) => marcadas.has(flag));
  return {
    ...(exigidas.riesgoGraduado && marcadas.has(CLAVE_RIESGO_GRADUADO) ? { confirmoRiesgo: true } : {}),
    ...(flags.length > 0 ? { confirmoFlags: flags } : {}),
    ...(exigidas.menciones && marcadas.has(CLAVE_MENCIONES) ? { confirmoMenciones: true } : {}),
  };
}

/** Lo que falta confirmar: las claves exigidas que el cuerpo no declara. */
export function confirmacionesFaltantes(
  exigidas: ConfirmacionesParaAprobar,
  dadas: ConfirmacionesDadas,
): string[] {
  const confirmados = new Set(dadas.confirmoFlags ?? []);
  return [
    ...exigidas.flags.filter((flag) => !confirmados.has(flag)),
    ...(exigidas.riesgoGraduado && dadas.confirmoRiesgo !== true ? [CLAVE_RIESGO_GRADUADO] : []),
    ...(exigidas.menciones && dadas.confirmoMenciones !== true ? [CLAVE_MENCIONES] : []),
  ];
}
