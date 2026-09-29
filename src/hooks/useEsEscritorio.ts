"use client";

import { useSyncExternalStore } from "react";

/** El breakpoint `lg` de Tailwind (64rem = 1024px), el mismo en que el
 *  lateral aparece y el sheet deja de ser una hoja de abajo. Estaba escrito
 *  tres veces, en tres notaciones. */
export const CONSULTA_ESCRITORIO = "(min-width: 64rem)";

function suscribir(avisar: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
  consulta.addEventListener?.("change", avisar);
  return () => consulta.removeEventListener?.("change", avisar);
}

function enCliente(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(CONSULTA_ESCRITORIO).matches;
}

/**
 * ¿El viewport está en `lg:` o más? Para lo que no puede leerse de una clase
 * responsive (números de framer-motion, pedir un conteo sólo si el menú se
 * ve). En el servidor y en la hidratación, falso.
 */
export function useEsEscritorio(): boolean {
  return useSyncExternalStore(suscribir, enCliente, () => false);
}
