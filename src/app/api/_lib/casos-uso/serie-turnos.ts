// Las fechas de una serie de turnos. Función pura: la regla de "cada cuánto
// y hasta cuándo" vive acá y se testea sin base.
//
// Una serie es el turno elegido más sus repeticiones cada 7 (semanal) o 14
// (quincenal) días, durante HORIZONTE_MESES meses de calendario contados
// desde ese primer turno. No hay renovación automática ni aviso: cuando la
// serie se acaba, la profesional agenda otra (decisión del dueño,
// docs/esquema.md §2 punto 15). Cada turno generado es una fila independiente.
//
// Montevideo no tiene horario de verano desde 2015, así que sumar días en
// milisegundos conserva la hora local exacta (ver agregarDiasMvd).

import type { FrecuenciaSerie } from "@/lib/constantes-turno";
import { agregarDiasMvd, instanteMvd, partesMvd } from "@/lib/fechas-montevideo";

/** Meses de calendario que cubre una serie al crearla. */
export const HORIZONTE_MESES = 3;

/** Cinturón de seguridad: una serie nunca genera más filas que esto por
 *  llamada, aunque alguien cambie el horizonte o la frecuencia. Con 3 meses
 *  semanales son 13 o 14 turnos. */
export const TOPE_TURNOS_POR_SERIE = 30;

const DIAS_POR_FRECUENCIA: Record<FrecuenciaSerie, number> = {
  semanal: 7,
  quincenal: 14,
};

/**
 * Primer turno + repeticiones hasta HORIZONTE_MESES meses después (el mismo
 * día y hora de Montevideo, tres meses más adelante, queda afuera), acotado
 * a TOPE_TURNOS_POR_SERIE. El ancla siempre es la primera.
 */
export function fechasDeSerie(
  ancla: Date,
  frecuencia: FrecuenciaSerie,
): Date[] {
  const p = partesMvd(ancla);
  const limite = instanteMvd(
    p.anio,
    p.mes + HORIZONTE_MESES,
    p.dia,
    p.hora,
    p.minuto,
  );
  const paso = DIAS_POR_FRECUENCIA[frecuencia];
  const fechas: Date[] = [];
  let fecha = ancla;
  while (fecha.getTime() < limite.getTime() && fechas.length < TOPE_TURNOS_POR_SERIE) {
    fechas.push(fecha);
    fecha = agregarDiasMvd(fecha, paso);
  }
  return fechas;
}
