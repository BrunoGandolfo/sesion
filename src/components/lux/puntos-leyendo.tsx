"use client";

// Los tres puntos de "Lux está leyendo": se encienden de a uno, en el color
// del texto, mientras Lux trabaja (la apertura y cada respuesta). El sol no
// se mueve nunca; lo único que dice "sigue trabajando" son estos puntos.
//
// Una excepción a "nada gira ni late solo" (docs/diseno/01-tokens.md), con
// el mismo motivo que el anillo de "escribiendo la nota": una lectura con
// transcripciones tarda decenas de segundos y una frase quieta se lee como
// "se colgó". Con movimiento reducido los puntos quedan fijos.
//
// Los tiempos salen de movimiento.ts: cada punto se enciende en
// TIEMPOS.pliegue con la curva SUAVE, y entre punto y punto pasa un pliegue
// más una navegación (400 ms). Tres pasos: el ciclo dura 1,2 s, el mismo que
// gira-procesando.

import { motion } from "framer-motion";

import { useMovimientoReducido } from "@/hooks/useMovimientoReducido";
import { SUAVE, TIEMPOS } from "@/lib/movimiento";

const PASO_MS = TIEMPOS.pliegue + TIEMPOS.navegacion;
const PUNTOS = 3;
export const CICLO_LEYENDO_MS = PASO_MS * PUNTOS;
const APAGADO = 0.2;

/** Cuándo se enciende cada punto dentro del ciclo, en fracciones de 0 a 1. */
export function tramoDelPunto(indice: number): { empieza: number; encendido: number } {
  const empieza = (indice * PASO_MS) / CICLO_LEYENDO_MS;
  return { empieza, encendido: (indice * PASO_MS + TIEMPOS.pliegue) / CICLO_LEYENDO_MS };
}

export function PuntosLeyendo() {
  const reducido = useMovimientoReducido();
  if (reducido) {
    return <span aria-hidden="true" data-puntos="quietos">...</span>;
  }
  return (
    <span aria-hidden="true" data-puntos="encendiendo">
      {Array.from({ length: PUNTOS }, (_, i) => {
        const { empieza, encendido } = tramoDelPunto(i);
        return (
          <motion.span
            key={i}
            initial={{ opacity: APAGADO }}
            animate={{ opacity: [APAGADO, APAGADO, 1, 1] }}
            transition={{
              duration: CICLO_LEYENDO_MS / 1000,
              times: [0, empieza, encendido, 1],
              ease: [...SUAVE],
              repeat: Infinity,
            }}
          >
            .
          </motion.span>
        );
      })}
    </span>
  );
}
