"use client";

// Las barras: una por período de la serie, del valor de lo TRABAJADO. La
// parte ya cobrada va llena en salvia y la que falta, en trazo: dos segmentos
// en la misma barra, así se ven las dos platas sin dos gráficos.
//
// SVG propio, sin librería. Cada barra es un botón: tocarla abre el detalle
// de ese período (sheet-periodo.tsx). Sin animación de entrada: los números
// no se mueven (movimiento.tsx, Contador).

import * as React from "react";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";
import { money } from "@/lib/format";
import {
  ANIO_A_ANIO,
  BARRAS_QUE_SON,
  BARRA_ARIA,
  BARRA_COBRADO,
  BARRA_SIN_COBRAR,
  MES_A_MES,
  TOCA_UNA_BARRA,
} from "@/lib/glosario";

import { Bloque } from "./bloques";
import { nombrePeriodo, rotuloBarra } from "./periodo";

export type EntradaSerie = ResumenFinanzas["serie"][number];

/** El alto del dibujo, en unidades del viewBox. El ancho lo pone la grilla. */
const ALTO = 100;
/** Una barra en cero igual se dibuja: una raya, para que se pueda tocar y
 *  se vea que ese período existe. */
const ALTO_MINIMO = 1.5;

export function Barras({
  serie,
  granularidad,
  onElegir,
}: {
  serie: EntradaSerie[];
  granularidad: ResumenFinanzas["granularidad"];
  onElegir: (entrada: EntradaSerie) => void;
}) {
  const maximo = Math.max(0, ...serie.map((e) => e.trabajado));

  return (
    <Bloque titulo={granularidad === "anio" ? ANIO_A_ANIO : MES_A_MES}>
      <p className="mt-1 text-[12px] text-ink-500">{BARRAS_QUE_SON}</p>
      <ul aria-hidden="true" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-700">
        <li className="inline-flex items-center gap-1.5">
          <Muestra lleno />
          {BARRA_COBRADO}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Muestra lleno={false} />
          {BARRA_SIN_COBRAR}
        </li>
      </ul>

      <ol className="mt-4 flex h-44 items-stretch gap-1 border-b border-[color:var(--border-subtle)] lg:h-52 lg:gap-2">
        {serie.map((entrada) => (
          <li key={entrada.clave} className="flex min-w-0 max-w-16 flex-1">
            <Barra entrada={entrada} maximo={maximo} onElegir={onElegir} />
          </li>
        ))}
      </ol>
      <ol aria-hidden="true" className="mt-1.5 flex gap-1 lg:gap-2">
        {serie.map((entrada) => (
          <li
            key={entrada.clave}
            className="min-w-0 max-w-16 flex-1 truncate text-center text-[12px] tabular-nums text-ink-500"
          >
            {rotuloBarra(entrada.clave)}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-ink-500">{TOCA_UNA_BARRA}</p>
    </Bloque>
  );
}

function Barra({
  entrada,
  maximo,
  onElegir,
}: {
  entrada: EntradaSerie;
  maximo: number;
  onElegir: (entrada: EntradaSerie) => void;
}) {
  const escala = maximo > 0 ? ALTO / maximo : 0;
  const cobrado = entrada.trabajadoCobrado * escala;
  const falta = entrada.trabajadoSinCobrar * escala;
  const vacia = entrada.trabajado === 0;

  return (
    <button
      type="button"
      data-clave={entrada.clave}
      onClick={() => onElegir(entrada)}
      aria-label={BARRA_ARIA(
        nombrePeriodo(entrada.clave),
        money(entrada.trabajado),
        money(entrada.trabajadoCobrado),
        money(entrada.trabajadoSinCobrar),
      )}
      className="flex w-full min-w-0 items-end rounded-sm px-0.5 transition-colors duration-[var(--duration-fast)] hover:bg-cream-100"
    >
      <svg
        viewBox={`0 0 10 ${ALTO}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-full w-full overflow-visible"
      >
        {vacia ? (
          <rect x={0} y={ALTO - ALTO_MINIMO} width={10} height={ALTO_MINIMO} className="fill-cream-200" />
        ) : (
          <>
            {falta > 0 ? (
              <rect
                x={0.5}
                y={ALTO - cobrado - falta}
                width={9}
                height={falta}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.5}
                className="fill-white stroke-sage-500"
              />
            ) : null}
            {cobrado > 0 ? (
              <rect x={0} y={ALTO - cobrado} width={10} height={cobrado} className="fill-sage-500" />
            ) : null}
          </>
        )}
      </svg>
    </button>
  );
}

/** El cuadradito de la leyenda: el mismo dibujo que la barra, en chico. */
function Muestra({ lleno }: { lleno: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
      {lleno ? (
        <rect x={0} y={0} width={12} height={12} rx={2} className="fill-sage-500" />
      ) : (
        <rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} strokeWidth={1.5} className="fill-white stroke-sage-500" />
      )}
    </svg>
  );
}
