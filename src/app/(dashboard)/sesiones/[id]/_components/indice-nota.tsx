"use client";

// Índice de la nota: una tira corta, pegada arriba, para saltar de sección.
//
// La nota mide varias pantallas (en el teléfono, miles de píxeles) y no tenía
// forma de ir al Plan sin arrastrar todo lo anterior. La tira queda a la vista
// mientras se lee, así el salto sirve desde cualquier punto y no sólo desde
// arriba. Es una sola línea que se desliza de costado: en 390 px no entran
// las seis y dos renglones fijos le sacarían demasiado alto a la lectura.
//
// Son botones que desplazan, no enlaces con #ancla: un ancla agrega una
// entrada al historial por cada salto y el "Volver" del teléfono pasaría a
// recorrer secciones en vez de salir de la nota.

import { INDICE_NOTA } from "./textos";

export interface EntradaIndice {
  /** id del elemento al que salta. */
  destino: string;
  titulo: string;
}

export function IndiceNota({ entradas }: { entradas: EntradaIndice[] }) {
  if (entradas.length < 2) return null;

  return (
    <nav
      aria-label={INDICE_NOTA}
      className="sticky top-0 z-10 -mx-5 border-b border-[color:var(--border-subtle)] bg-cream-50 px-5 lg:mx-0 lg:px-0"
    >
      <ul className="flex gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entradas.map(({ destino, titulo }) => (
          <li key={destino} className="shrink-0">
            <button
              type="button"
              onClick={() => document.getElementById(destino)?.scrollIntoView?.({ block: "start" })}
              className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md px-3 font-sans text-[13px] font-semibold text-sage-700 transition-colors duration-[var(--duration-fast)] hover:bg-sage-50"
            >
              {titulo}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
