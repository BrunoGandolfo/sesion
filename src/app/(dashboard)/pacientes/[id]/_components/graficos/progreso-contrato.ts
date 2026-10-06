// El contrato de GET /api/pacientes/[id]/progreso?rango= y lo que se deriva
// de él sin dibujar nada: el orden de la alianza, la señal de riesgo de una
// sesión, los tramos con dato de una línea. Sin React y sin "use client":
// también lo lee la hoja de impresión del Recorrido.
//
// Dos reglas que no se negocian:
//   - Un valor ausente NO se interpola. La línea se corta y se retoma en el
//     siguiente dato real (ver `segmentosDe`).
//   - Con más de MAX_MARCADORES puntos los marcadores se reducen a los
//     extremos y a las sesiones con señal de riesgo, que nunca se ocultan.

import { fechaCorta } from "@/lib/format";
import type { AlianzaTerapeutica, NivelRiesgo } from "@/types/domain";

import { SIN_DATO } from "./textos";

export type RangoProgreso = "10s" | "3m" | "6m" | "todo";

export const RANGOS: readonly RangoProgreso[] = ["10s", "3m", "6m", "todo"];

export function esRango(valor: string | null | undefined): valor is RangoProgreso {
  return valor === "10s" || valor === "3m" || valor === "6m" || valor === "todo";
}

export type TendenciaTema = "nuevo" | "sube" | "baja" | "estable";

/** Flags booleanos de la sesión. Se deja abierto porque el contrato de riesgo
 *  puede sumar señales y ninguna debe perderse por no estar enumerada acá. */
export type FlagsRiesgoProgreso = Record<string, boolean | undefined>;

export type SesionProgreso = {
  sesionId: string;
  fecha: string;
  numero: number;
  intensidadEmocional: number | null;
  /** Nivel de alianza tal como lo nombra el contrato ("fragil"…"fuerte"). */
  alianzaTerapeutica: AlianzaTerapeutica | null;
  temas: string[];
  nivelRiesgo: NivelRiesgo | null;
  flagsRiesgo: FlagsRiesgoProgreso;
  intervenciones: Record<string, number>;
  observacionIA: string | null;
  progresoPercibido: string | null;
};

export type TemaProgreso = {
  tema: string;
  conteo: number;
  deTotal: number;
  primeraVez: string;
  ultimaVez: string;
  tendencia: TendenciaTema;
};

export type RiesgoProgreso = {
  sesionId: string;
  fecha: string;
  flag: string;
  nivel: NivelRiesgo | null;
  cita: string | null;
};

export type ProgresoResponse = {
  pacienteId: string;
  totalSesiones: number;
  rango: RangoProgreso;
  sesiones: SesionProgreso[];
  temas: TemaProgreso[];
  riesgos: RiesgoProgreso[];
};

// ────────────────────────────────────────────────────────────────────────────
// Alianza terapéutica: nombre y orden
// El nombre es el clínico y no se traduce. El orden 1..4 existe solo para
// poder dibujar una línea; el eje se rotula con los nombres, no con números.
// ────────────────────────────────────────────────────────────────────────────

const ORDEN_ALIANZA: Record<AlianzaTerapeutica, number> = {
  fragil: 1,
  inestable: 2,
  estable: 3,
  fuerte: 4,
};

export function nivelDeAlianza(
  valor: AlianzaTerapeutica | null | undefined,
): number | null {
  if (!valor) return null;
  return ORDEN_ALIANZA[valor] ?? null;
}

/** Una sesión tiene señal si el nivel graduado no es "ninguno" o si algún
 *  flag booleano está activo. Las dos vías cuentan: el contrato de riesgo
 *  las mantiene separadas y ninguna se descarta. */
export function tieneSenal(sesion: SesionProgreso): boolean {
  if (sesion.nivelRiesgo !== null && sesion.nivelRiesgo !== "ninguno") {
    return true;
  }
  return Object.values(sesion.flagsRiesgo ?? {}).some((v) => v === true);
}

export function fechaDe(sesion: { fecha: string }): Date {
  return new Date(sesion.fecha);
}

/** Más de esto y los marcadores se reducen a extremos + señales de riesgo. */
export const MAX_MARCADORES = 12;

export type PuntoLinea = {
  fecha: Date;
  /** null = la sesión no registró el dato. No se interpola. */
  valor: number | null;
  /** Se dibuja siempre, aunque el resto de los marcadores esté oculto. */
  destacado?: boolean;
  /** Texto del <title> del marcador (lectura al pasar o al tocar). */
  detalle?: string;
};

/** Tramos consecutivos con dato. Cada corte es una sesión sin registro. */
export function segmentosDe(puntos: PuntoLinea[]): number[][] {
  const segmentos: number[][] = [];
  let actual: number[] = [];
  puntos.forEach((punto, i) => {
    if (punto.valor === null) {
      if (actual.length > 0) segmentos.push(actual);
      actual = [];
      return;
    }
    actual.push(i);
  });
  if (actual.length > 0) segmentos.push(actual);
  return segmentos;
}

export type BarraPorFecha = {
  fecha: Date;
  valores: Record<string, number>;
  detalle?: string;
};

/** Texto del <title> de un marcador: "4 mar · 7 de 10" o "4 mar · Sin dato". */
export function detalleDePunto(
  fecha: Date,
  valor: string | null,
): string {
  return `${fechaCorta(fecha)} · ${valor ?? SIN_DATO}`;
}
