// Lectura de la agenda: qué rango se pide, cómo se pide y cómo se mueve el
// día de referencia con las flechas.
//
// Vive fuera de agenda-view.tsx porque no es pantalla: es el borde entre
// /api/turnos y el render. Sin estado, sin efectos, sin React.

import { apiGet } from "@/lib/api-client";
import {
  agregarDiasMvd,
  agregarMesesMvd,
  finDelDiaMvd,
  inicioDeMesMvd,
  inicioDeSemanaMvd,
  inicioFinDiaMvd,
} from "@/lib/fechas-montevideo";
import { parseTurno, type TurnoJson } from "@/lib/json-turno";
import type { TurnoConPaciente } from "@/types/domain";

export type AgendaViewMode = "día" | "semana" | "mes";

export interface RangoAgenda {
  desde: Date;
  hasta: Date;
}

// El rango que se le pide a la API. Los bordes son los del día de
// Montevideo, no los del dispositivo: con `setHours` un teléfono en Madrid
// pedía de las 19:00 del día anterior a las 18:59 del día, y la sesión de
// las 21:30 quedaba fuera de su propio día.
export function computeRange(view: AgendaViewMode, anchor: Date): RangoAgenda {
  if (view === "día") {
    return inicioFinDiaMvd(anchor);
  }
  if (view === "semana") {
    const desde = inicioDeSemanaMvd(anchor);
    return { desde, hasta: finDelDiaMvd(agregarDiasMvd(desde, 6)) };
  }
  // Seis semanas completas desde el lunes de la semana en que cae el día 1:
  // la grilla del mes siempre dibuja 42 celdas.
  const desde = inicioDeSemanaMvd(inicioDeMesMvd(anchor));
  return { desde, hasta: finDelDiaMvd(agregarDiasMvd(desde, 41)) };
}

/** Los turnos del rango, con las fechas ya como Date. */
export async function leerTurnos(
  range: RangoAgenda,
  signal?: AbortSignal,
): Promise<TurnoConPaciente[]> {
  // Con los cancelados: la agenda los muestra apagados (session-row y el
  // punto gris del mes ya los distinguen). Sin este parámetro la API los
  // filtra, y un turno cancelado desaparecía de la grilla como si nunca
  // hubiera existido — que es lo que la deja sin saber si lo canceló.
  const url =
    `/api/turnos?desde=${encodeURIComponent(range.desde.toISOString())}` +
    `&hasta=${encodeURIComponent(range.hasta.toISOString())}` +
    `&includeCancelados=true`;
  const data = await apiGet<TurnoJson<TurnoConPaciente>[]>(url, { signal });
  return data.map((t) => parseTurno(t));
}

/** Lo que dibuja la pantalla en el momento de tocar una flecha. */
export interface VistaAgenda {
  view: AgendaViewMode;
  isMobile: boolean;
  mesAbierto: boolean;
}

/** El día de referencia después de una flecha: `signo` -1 es atrás, 1 es
 *  adelante. Un paso es un mes con el mes abierto en el teléfono o en la
 *  vista mes, una semana en la tira del teléfono o en la vista semana, y un
 *  día en la vista día. */
export function moverAncla(
  ancla: Date,
  signo: -1 | 1,
  { view, isMobile, mesAbierto }: VistaAgenda,
): Date {
  if (isMobile && mesAbierto) return agregarMesesMvd(ancla, signo);
  // Mes plegado: las flechas mueven la tira de a una semana.
  if (isMobile) return agregarDiasMvd(ancla, 7 * signo);
  if (view === "día") return agregarDiasMvd(ancla, signo);
  if (view === "semana") return agregarDiasMvd(ancla, 7 * signo);
  return agregarMesesMvd(ancla, signo);
}
