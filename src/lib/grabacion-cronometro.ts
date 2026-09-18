// El tiempo de una grabación: cuánto se grabó de verdad y cómo se muestra.
//
// Salió de src/components/grabacion/GrabadorSesion.tsx sin tocar una línea de
// la aritmética. Es la parte del grabador que no necesita ni micrófono ni
// React, y por eso es la que se puede probar sola.
//
// El módulo del grabador sigue re-exportando estas tres cosas: hay una
// pantalla (`grabar-view.tsx`) que importa `formatearDuracion` desde ahí, y
// no la puedo tocar en esta tanda.

import type { Pausa } from "@/lib/grabacion-storage";

/** Pausa cerrada, en ISO, tal como viaja con la sesión. */
export interface PausaRegistrada {
  inicio: string;
  fin: string;
}

/** "07:32". La pantalla muestra el mismo formato. */
export function formatearDuracion(totalSegundos: number) {
  const minutos = Math.floor(totalSegundos / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (totalSegundos % 60).toString().padStart(2, "0");
  return `${minutos}:${segundos}`;
}

/**
 * Segundos efectivamente grabados. Función pura: es la única fuente de
 * verdad del cronómetro y lo que se testea.
 *
 * `inicio` es el epoch del arranque de la grabación; `pausas` son los tramos
 * detenidos (una pausa con `fin` en null se considera abierta hasta `ahora`).
 * `baseSegundos` suma lo que ya venía grabado de una recuperación.
 *
 * Las pausas se asumen disjuntas y dentro de [inicio, ahora]; así las produce
 * el grabador (nunca hay dos abiertas a la vez). Los tramos que caen fuera de
 * la ventana se recortan.
 */
export function segundosGrabados(
  inicio: number | null,
  ahora: number,
  pausas: readonly Pausa[] = [],
  baseSegundos = 0,
): number {
  const base = Math.max(0, Math.floor(baseSegundos));

  if (inicio === null) {
    return base;
  }

  const fin = Math.max(inicio, ahora);
  let pausadoMs = 0;

  for (const pausa of pausas) {
    const desde = Math.max(pausa.inicio, inicio);
    const hasta = Math.min(pausa.fin ?? fin, fin);

    if (hasta > desde) {
      pausadoMs += hasta - desde;
    }
  }

  const activoMs = Math.max(0, fin - inicio - pausadoMs);

  return base + Math.floor(activoMs / 1000);
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
