"use client";

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "framer-motion";

const suscribir = () => () => {};
const cliente = () => true;
const servidor = () => false;

/** Servidor y primera hidratación dibujan la misma versión estática.
 * Después, se respeta la preferencia real y sus cambios sin alterar el HTML
 * durante la hidratación. Nunca arranca animado para quien pidió quietud. */
export function useMovimientoReducido() {
  const hidratado = useSyncExternalStore(suscribir, cliente, servidor);
  const reducido = useReducedMotion();
  return !hidratado || reducido !== false;
}
