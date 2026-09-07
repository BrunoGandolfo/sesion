// Caso de uso: dos sesiones no pueden ocurrir a la vez.
//
// Hasta acá se podían agendar dos turnos a la misma hora sin que nada dijera
// nada. No es un capricho de prolijidad: la app es de una profesional que
// atiende de a una persona, así que un solapamiento es siempre un error de
// tipeo, y se descubre el día del turno con las dos pacientes en la puerta.
//
// ─── QUÉ CUENTA COMO OCUPADO ────────────────────────────────────────────────
//
// Un turno ocupa el intervalo [fecha, fecha + duración), abierto en el final:
// un turno que arranca exactamente cuando termina el anterior NO se superpone.
// Es el caso normal de una agenda seguida (10:00-10:50 y 10:50-11:40) y
// rechazarlo haría inusable la app.
//
// Sólo ocupan lugar los turnos "programado" y "realizado". Un turno cancelado
// o al que la paciente no vino no ocupa nada: liberar ese hueco es
// precisamente para lo que se cancela.
//
// ─── POR QUÉ SE LEE UNA VENTANA Y SE COMPARA EN MEMORIA ─────────────────────
//
// La condición de solapamiento necesita `fecha + duración` de las DOS filas, y
// la duración es una columna: no hay forma de escribirla en un `where` de
// Prisma sin SQL crudo. En vez de eso se lee una ventana acotada —los turnos
// que empiezan como mucho DURACION_MAXIMA antes del fin del nuevo, y no
// después— y se aplica el predicado puro sobre esas filas.
//
// La ventana es correcta, no aproximada: un turno que empieza antes de
// `inicio - DURACION_MAXIMA` no puede llegar a `inicio` ni durando lo máximo,
// y uno que empieza en `fin` o después ya no toca el intervalo. Y es chica:
// en el peor caso, los turnos de una hora y media alrededor.

import type { db } from "@/lib/db";

import { TURNO_SOLAPADO } from "@/lib/glosario";

import { ApiError } from "../responses";

type ClienteTurnos = Pick<typeof db, "turno">;

const MS_POR_MINUTO = 60_000;

/**
 * La duración más larga que admite `duracionSchema`. Si mañana se agrega una
 * de 120, esta constante tiene que crecer con ella o la ventana empieza a
 * dejar afuera solapamientos reales; el test lo fija contra el schema.
 */
export const DURACION_MAXIMA_MIN = 90;

/** Estados que efectivamente ocupan el horario. Espejo de TurnoEstado menos
 *  "cancelado" y "ausente". */
export const ESTADOS_QUE_OCUPAN = ["programado", "realizado"] as const;

/** Un turno reducido a lo único que importa para esta regla. */
export interface Intervalo {
  inicio: Date;
  duracionMin: number;
}

function finDe(intervalo: Intervalo): number {
  return intervalo.inicio.getTime() + intervalo.duracionMin * MS_POR_MINUTO;
}

/**
 * ¿Se pisan estos dos intervalos?
 *
 * `a.inicio < b.fin && b.inicio < a.fin`, con los dos extremos abiertos en el
 * final. Función pura y exportada: es la regla, y es lo que se testea en los
 * bordes sin tocar la base.
 */
export function seSolapan(a: Intervalo, b: Intervalo): boolean {
  return a.inicio.getTime() < finDe(b) && b.inicio.getTime() < finDe(a);
}

export interface TurnoOcupado {
  id: string;
  fecha: Date;
  duracion: number;
}

export interface BuscarSolapadoParams {
  prisma: ClienteTurnos;
  organizationId: string;
  /** El intervalo que se quiere ocupar. */
  intervalo: Intervalo;
  /** El turno que se está editando, para que no choque consigo mismo. */
  excluirTurnoId?: string;
}

/**
 * El primer turno que se pisa con `intervalo`, o null. Devuelve la fila
 * —y no un booleano— para que el mensaje pueda decir con cuál choca.
 */
export async function buscarTurnoSolapado({
  prisma,
  organizationId,
  intervalo,
  excluirTurnoId,
}: BuscarSolapadoParams): Promise<TurnoOcupado | null> {
  const desde = new Date(
    intervalo.inicio.getTime() - DURACION_MAXIMA_MIN * MS_POR_MINUTO,
  );
  const hasta = new Date(finDe(intervalo));

  const candidatos = await prisma.turno.findMany({
    where: {
      organizationId,
      estado: { in: [...ESTADOS_QUE_OCUPAN] },
      // `gt` en el borde inferior y `lt` en el superior: un turno que termina
      // justo cuando este empieza queda fuera por el predicado igual, pero
      // acotar acá también evita traerlo.
      fecha: { gt: desde, lt: hasta },
      ...(excluirTurnoId ? { id: { not: excluirTurnoId } } : {}),
    },
    select: { id: true, fecha: true, duracion: true },
    orderBy: { fecha: "asc" },
  });

  return (
    candidatos.find((candidato) =>
      seSolapan(intervalo, {
        inicio: candidato.fecha,
        duracionMin: candidato.duracion,
      }),
    ) ?? null
  );
}

/**
 * Lo mismo, pero lanzando el 409 que la UI ya sabe mostrar (los formularios
 * pintan `error.mensaje` de la API tal cual).
 */
export async function assertSinSolapamiento(
  params: BuscarSolapadoParams,
): Promise<void> {
  const ocupado = await buscarTurnoSolapado(params);

  if (ocupado) {
    throw new ApiError(TURNO_SOLAPADO, 409);
  }
}
