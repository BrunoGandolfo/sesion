// Lux, el sol. El personaje que lee la ficha de una paciente con la
// profesional, dibujado a mano sobre la misma grilla de 24 que Lupita
// (docs/diseno/04-personaje.md).
//
// Un disco y ocho rayos cortos. Sin cara, como Lupita: a 20 px dos ojitos
// son ruido, y un sol con cara es una mascota.
//
// QUIETO, Y ES SU RASGO
//
// Lupita brota y celebra; Lux no se mueve nunca. Vive en la ficha, al lado
// del material clínico, donde nada late ni gira (docs/diseno/01-tokens.md).
// Por eso no importa framer-motion ni lee prefers-reduced-motion: no hay
// nada que reducir.
//
// SIEMPRE DECORATIVO
//
// aria-hidden fijo: acompaña a un rótulo ("Lux") o a un texto que ya dice
// todo. Si alguna vez queda solo, sin texto al lado, está mal puesto.

import * as React from "react";

/**
 * Los mismos dos tamaños de Lupita que tienen sentido acá:
 *
 *   20 — inline, al lado del rótulo de la pestaña o de un mensaje de Lux.
 *   72 — encabezado de la conversación.
 */
export const TAMANOS_LUX = { inline: 20, encabezado: 72 } as const;

/** El mismo peso de trazo que los íconos de la app y que Lupita. */
const TRAZO = 1.8;

const RADIO_DISCO = 4.2;
const RAYO_DESDE = 7;
const RAYO_HASTA = 9.6;

/** Ocho rayos, cada 45°, calculados una vez y redondeados a centésimas para
 *  que el SVG sea el mismo en el servidor y en el navegador. */
const RAYOS = Array.from({ length: 8 }, (_, i) => {
  const angulo = (i * Math.PI) / 4;
  const punto = (radio: number) => ({
    x: Number((12 + radio * Math.cos(angulo)).toFixed(2)),
    y: Number((12 + radio * Math.sin(angulo)).toFixed(2)),
  });
  const desde = punto(RAYO_DESDE);
  const hasta = punto(RAYO_HASTA);
  return `M${desde.x} ${desde.y}L${hasta.x} ${hasta.y}`;
});

export interface LuxProps {
  /** Lado del dibujo en píxeles. Ver TAMANOS_LUX. */
  tamano?: number;
  className?: string;
}

/** Lux. Una sola pose: está, y nada más. */
export function Lux({ tamano = TAMANOS_LUX.inline, className }: LuxProps) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-personaje="lux"
      className={className}
    >
      <circle
        cx={12}
        cy={12}
        r={RADIO_DISCO}
        className="fill-gold-50 stroke-gold-500"
        strokeWidth={TRAZO}
      />
      {RAYOS.map((d) => (
        <path
          key={d}
          d={d}
          className="stroke-gold-500"
          strokeWidth={TRAZO}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
