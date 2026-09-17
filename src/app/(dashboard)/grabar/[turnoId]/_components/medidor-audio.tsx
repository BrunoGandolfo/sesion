"use client";

// Medidor de nivel de entrada. No es decoración: es la única forma de saber,
// sin escuchar el audio, que el micrófono está tomando la sesión. Por eso la
// leyenda dice el estado en castellano y no un número de decibeles.
//
// La leyenda del silencio ES el aviso persistente de "no está entrando
// sonido": está acá, al lado de las barras en cero, que es donde se mira. No
// se repite en la pila de avisos de arriba — un mismo hecho, un solo lugar.
//
// Acompaña toda la grabación, no sólo la captura: con la grabación en pausa
// queda a la vista, en cero, diciendo que está en pausa. Que desaparezca es
// justo lo que hace dudar de si el micrófono sigue ahí.

import { AVISO_SIN_SONIDO } from "@/lib/glosario";

const SEGMENTOS = 14;

export function MedidorAudio({
  nivel,
  silencioso,
  capturando,
}: {
  /** 0-1. */
  nivel: number | null;
  /** true cuando hace SILENCIO_VISIBLE_AVISO_SEG (2 min) que no entra
   *  sonido y la pantalla está a la vista. En sesión un silencio corto es
   *  normal, así que el umbral es generoso a propósito. */
  silencioso: boolean;
  /** false con la grabación abierta pero en pausa: no hay micrófono que medir. */
  capturando: boolean;
}) {
  const encendidos = !capturando || silencioso
    ? 0
    : Math.min(SEGMENTOS, Math.round((nivel ?? 0) * SEGMENTOS));

  const leyenda = !capturando
    ? "En pausa: no está entrando sonido"
    : nivel === null
      ? "Medidor de sonido no disponible"
      : silencioso
        ? AVISO_SIN_SONIDO
        : "El audio se escucha bien";

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex h-6 w-full max-w-[280px] items-end justify-center gap-[3px]">
        {Array.from({ length: SEGMENTOS }).map((_, indice) => {
          const activo = indice < encendidos;

          return (
            <span
              key={indice}
              aria-hidden="true"
              className={`w-full rounded-[2px] transition-[height,background-color] duration-[var(--duration-fast)] ${
                activo ? "bg-sage-500" : "bg-cream-200"
              }`}
              style={{ height: `${activo ? 10 + indice : 6}px` }}
            />
          );
        })}
      </div>

      <p
        aria-live="polite"
        className={`font-sans text-[13px] leading-[1.5] ${
          capturando && silencioso ? "text-terracotta-600" : "text-ink-500"
        }`}
      >
        {leyenda}
      </p>
    </div>
  );
}
