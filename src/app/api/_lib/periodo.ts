// Períodos del consultorio: "AAAA-MM" y "AAAA-MM-DD", siempre en Montevideo.
//
// Existe para que haya UN parser. Las finanzas piden meses enteros, el
// historial clínico acepta mes o día, y los dos tienen que estar de acuerdo
// sobre dónde empieza y termina un mes: las columnas son `timestamp` sin
// zona y el proceso corre en UTC, así que una sesión del 31 a las 23:30 de
// Montevideo es 02:30 UTC del día 1 y, sin corregir, caería en el mes
// siguiente.
//
// Quien decide qué día es sigue siendo src/lib/fechas-montevideo.ts: acá sólo
// se parsea el texto y se piden los bordes a ese módulo.

import { instanteMvd, partesMvd } from "@/lib/fechas-montevideo";

import { ApiError } from "./responses";

/** "2026-09" */
export const MES_ISO = /^(\d{4})-(\d{2})$/;
/** "2026-09-30" */
export const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface MesMvd {
  anio: number;
  /** 0-11, como en Date. */
  mes: number;
}

export function parsearMes(texto: string): MesMvd {
  const m = MES_ISO.exec(texto);
  if (!m) throw new ApiError(`Mes inválido: ${texto} (se espera AAAA-MM)`, 400);
  const anio = Number(m[1]);
  const mes = Number(m[2]) - 1;
  if (mes < 0 || mes > 11) throw new ApiError(`Mes inválido: ${texto}`, 400);
  return { anio, mes };
}

export const formatearMes = ({ anio, mes }: MesMvd): string =>
  `${anio}-${String(mes + 1).padStart(2, "0")}`;

/** Meses enteros entre dos meses, contando los dos extremos. */
export function largoEnMeses(desde: MesMvd, hasta: MesMvd): number {
  return (hasta.anio - desde.anio) * 12 + (hasta.mes - desde.mes) + 1;
}

/**
 * Corre un mes `n` lugares (negativo hacia atrás).
 *
 * Va y vuelve por fechas-montevideo.ts en vez de hacer la cuenta acá:
 * `instanteMvd` normaliza el desborde de mes (mes 12 es enero del año que
 * viene, mes -1 es diciembre del anterior) y `partesMvd` lo lee de vuelta en
 * el calendario del consultorio. El mediodía es para no apoyarse en el borde
 * del día.
 */
export function correrMeses({ anio, mes }: MesMvd, n: number): MesMvd {
  return mesDe(instanteMvd(anio, mes + n, 1, 12));
}

/** El mes de Montevideo en que cae un instante. */
export const mesDe = (instante: Date): MesMvd => {
  const { anio, mes } = partesMvd(instante);
  return { anio, mes };
};

/** El primer instante del mes, en Montevideo. */
export const inicioDeMes = ({ anio, mes }: MesMvd) => instanteMvd(anio, mes, 1);
/** El último instante del mes, en Montevideo (día 0 del siguiente). */
export const finDeMes = ({ anio, mes }: MesMvd) =>
  instanteMvd(anio, mes + 1, 0, 23, 59, 59, 999);

export interface RangoMvd {
  desde: Date;
  hasta: Date;
}

/**
 * Los dos bordes del período que nombra un texto, en Montevideo.
 *
 *   "2026-09"     → del 1/9 00:00:00.000 al 30/9 23:59:59.999
 *   "2026-09-30"  → del 30/9 00:00:00.000 al 30/9 23:59:59.999
 *
 * `borde` dice cuál de los dos se devuelve cuando quien llama sólo quiere
 * uno: `desde` toma el principio y `hasta` el final. Así "desde=2026-09" y
 * "hasta=2026-09" describen el mes entero y no un instante suelto.
 */
export function rangoMvd(texto: string): RangoMvd {
  const dia = DIA_ISO.exec(texto);
  if (dia) {
    const [anio, mes, numero] = [Number(dia[1]), Number(dia[2]) - 1, Number(dia[3])];
    if (mes < 0 || mes > 11 || numero < 1 || numero > 31) {
      throw new ApiError(`Fecha inválida: ${texto}`, 400);
    }
    const desde = instanteMvd(anio, mes, numero);
    // Un día que no existe (31 de febrero) lo normaliza Date.UTC y cae en
    // otro mes: eso no es una fecha, es un error de quien pide.
    const partes = partesMvd(desde);
    if (partes.mes !== mes || partes.dia !== numero) {
      throw new ApiError(`Fecha inválida: ${texto}`, 400);
    }
    return {
      desde,
      hasta: instanteMvd(anio, mes, numero, 23, 59, 59, 999),
    };
  }
  const mes = parsearMes(texto);
  return { desde: inicioDeMes(mes), hasta: finDeMes(mes) };
}

/** El borde que corresponde: el principio para `desde`, el final para `hasta`. */
export function bordeMvd(texto: string, borde: "desde" | "hasta"): Date {
  return rangoMvd(texto)[borde];
}
