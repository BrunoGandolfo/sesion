"use client";

// El punto con número del ítem Hoy, en los dos menús, mientras haya avisos de
// notas sin ver (los mismos de la franja: avisos-de-notas.tsx). Lleva a Hoy
// porque ahí están, en Pendientes, las notas para revisar y las fallidas.

import * as React from "react";

import { useAvisosPendientes } from "./avisos-de-notas";
import { avisosEnHoy } from "./textos";

/** El punto que se ve. `className` lo ubica: sobre el ícono en el menú de
 *  abajo, al final del renglón en el lateral. El lector de pantalla no lo lee:
 *  lee `GlobitoHoyTexto`, que va después del nombre del ítem. */
export function GlobitoHoy({ className = "" }: { className?: string }) {
  const n = useAvisosPendientes().length;
  if (n === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-terracotta-600 px-1 font-sans text-[11px] font-semibold leading-none tabular-nums text-white ${className}`}
    >
      {n}
    </span>
  );
}

/** "Hoy, 1 nota para mirar" para el lector de pantalla. */
export function GlobitoHoyTexto() {
  const n = useAvisosPendientes().length;
  if (n === 0) return null;
  return <span className="sr-only">{`, ${avisosEnHoy(n)}`}</span>;
}
