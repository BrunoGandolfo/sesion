// Cómo se muestra el tiempo de una grabación y cómo viajan sus pausas.
// Cuánto se grabó lo dice grabacion-captura.ts, contando chunks.

import type { Pausa } from "@/lib/grabacion-storage";

/** Pausa cerrada, en ISO, tal como viaja con la sesión. */
export interface PausaRegistrada {
  inicio: string;
  fin: string;
}

/** "07:32". La pantalla muestra el mismo formato. */
export function formatearDuracion(totalSegundos: number) {
  const total = Math.floor(totalSegundos);
  const minutos = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (total % 60).toString().padStart(2, "0");
  return `${minutos}:${segundos}`;
}

/**
 * Las pausas cerradas, en ISO. Una pausa sin `fin` es una grabación todavía
 * detenida: no describe ningún tramo y se descarta.
 */
export function aRegistradas(pausas: readonly Pausa[]): PausaRegistrada[] {
  const cerradas: PausaRegistrada[] = [];

  for (const pausa of pausas) {
    if (pausa.fin === null) continue;
    cerradas.push({
      inicio: new Date(pausa.inicio).toISOString(),
      fin: new Date(pausa.fin).toISOString(),
    });
  }

  return cerradas;
}
