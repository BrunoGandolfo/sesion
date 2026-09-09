"use client";

// El control de dos o tres opciones de la app: las pestañas de la ficha, el
// filtro de Pacientes, el modo de vista de la agenda, las dos listas de
// Cobros.
//
// POR QUÉ LA PASTILLA SE SALÍA DEL RIEL
//
// El riel es `inline-flex` con `p-1`, así que mide lo que midan sus botones;
// y los botones no podían achicarse (`flex-shrink` sobre contenido con
// `min-width: auto` no achica nada). Cuando el contenedor de afuera era más
// angosto que la suma de los tres —la ficha a 390 px, el `Segmented` de
// Cobros—, el fondo crema quedaba recortado por el padre y el botón activo,
// blanco y con sombra, seguía dibujándose por afuera: la pastilla asomaba a
// la derecha del riel (docs/diseno/01-auditoria-frontend.md, sección (d)).
//
// El arreglo es de caja, no de movimiento: el riel nunca pasa del ancho
// disponible (`max-w-full`), los botones pueden achicarse (`min-w-0` +
// `shrink`) y el rótulo se acorta antes que empujar, y lo que llegara a
// sobrar queda recortado por el propio riel (`overflow-hidden`), no por el
// padre. Con dos o tres rótulos cortos —que es lo que hay— nada se acorta:
// simplemente ya no hay por dónde escaparse.
//
// SIN INDICADOR DESLIZANTE, A PROPÓSITO
//
// docs/diseno/03-plan-de-movimiento.md, sección 3, lo descarta explícito:
// es un control que se toca poco y el fondo blanco con sombra ya dice cuál
// está elegida; un `layoutId` más es superficie que mantener. Acá sólo
// cambian el color y la sombra, en los 150 ms de siempre.

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-cream-100 p-1 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex min-h-[44px] min-w-0 shrink items-center justify-center rounded-[6px] px-2 py-[6px] font-sans text-[13px] leading-none transition-[background-color,color,box-shadow] duration-150 sm:px-3 ${
              active
                ? "bg-white font-semibold text-ink-900 shadow-subtle"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
