// Los cuatro períodos de Finanzas y cómo se piden al servidor.
//
// La pantalla no hace cuentas (docs/contrato-finanzas.md): sólo traduce el
// chip elegido a `desde` / `hasta` y rotula lo que vuelve. Módulo puro, sin
// React, para testearlo solo.
//
// "Hoy" es el mes que dice el servidor (`deudaHoy.alDia`), no el reloj del
// teléfono: si el teléfono tiene la fecha corrida, la pantalla igual pide el
// mismo mes que el servidor usa para la deuda. Hasta que llega la primera
// respuesta se usa el reloj, en hora de Montevideo.

import { mesIsoMvd } from "@/lib/fechas-montevideo";
import { MESES, MESES_CORTOS } from "@/lib/glosario";

export type Periodo =
  | { tipo: "mes" }
  | { tipo: "anio"; anio: number }
  | { tipo: "doce" }
  | { tipo: "todo" };

/** El que se abre: el mismo default del servidor, y el que tiene barras. */
export const PERIODO_INICIAL: Periodo = { tipo: "doce" };

/** "AAAA-MM" del instante dado, en hora de Montevideo. */
export const mesDeHoy = mesIsoMvd;

function anioDe(clave: string): number {
  return Number(clave.slice(0, 4));
}

/**
 * La query de /api/finanzas/resumen para un período.
 *
 * - "12 meses" no manda nada: es el default del servidor.
 * - "Este año" va de enero al mes de hoy si es el año en curso (así la
 *   comparación con el año anterior mira los mismos meses), y de enero a
 *   diciembre si es un año pasado.
 * - "Todo" va desde `primerMesConDatos` y pide una barra por año.
 */
export function queryDe(
  periodo: Periodo,
  hoy: string,
  primerMesConDatos: string | null,
): string {
  switch (periodo.tipo) {
    case "doce":
      return "";
    case "mes":
      return `?desde=${hoy}&hasta=${hoy}`;
    case "anio": {
      const hasta = periodo.anio === anioDe(hoy) ? hoy : `${periodo.anio}-12`;
      return `?desde=${periodo.anio}-01&hasta=${hasta}`;
    }
    case "todo": {
      // `primerMesConDatos` cuenta también turnos agendados: si sólo hay
      // turnos futuros cae después de hoy, y el servidor rechaza un período
      // que termina antes de empezar.
      const desde = primerMesConDatos && primerMesConDatos < hoy ? primerMesConDatos : hoy;
      return `?desde=${desde}&hasta=${hoy}&granularidad=anio`;
    }
  }
}

/** Los años que se pueden elegir con ‹ ›: del primero con datos al de hoy. */
export function aniosElegibles(
  hoy: string,
  primerMesConDatos: string | null,
): { min: number; max: number } {
  const max = anioDe(hoy);
  return { min: primerMesConDatos ? Math.min(anioDe(primerMesConDatos), max) : max, max };
}

/** Cuántos meses van de `desde` a `hasta`, los dos incluidos. */
export function largoEnMeses(desde: string, hasta: string): number {
  const meses = (c: string) => anioDe(c) * 12 + Number(c.slice(5, 7));
  return meses(hasta) - meses(desde) + 1;
}

/** "agosto 2026" para "2026-08"; "2026" para "2026". */
export function nombrePeriodo(clave: string): string {
  if (clave.length === 4) return clave;
  const mes = Number(clave.slice(5, 7)) - 1;
  return `${MESES[mes]} ${clave.slice(0, 4)}`;
}

/** Rótulo corto de una barra: "ago" o "2026". */
export function rotuloBarra(clave: string): string {
  if (clave.length === 4) return clave;
  return MESES_CORTOS[Number(clave.slice(5, 7)) - 1];
}

/** Un rango de meses dicho corto: "agosto 2026", "ago–sep 2026",
 *  "dic 2025–ene 2026". */
export function nombreRango(desde: string, hasta: string): string {
  if (desde === hasta) return nombrePeriodo(desde);
  const corto = (c: string) => MESES_CORTOS[Number(c.slice(5, 7)) - 1];
  if (anioDe(desde) === anioDe(hasta)) {
    return `${corto(desde)}–${corto(hasta)} ${anioDe(hasta)}`;
  }
  return `${corto(desde)} ${anioDe(desde)}–${corto(hasta)} ${anioDe(hasta)}`;
}
