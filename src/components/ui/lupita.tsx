// Lupita, el brote. El personaje de la app, dibujado a mano sobre la grilla
// de 24 (docs/diseno/04-personaje.md, concepto A).
//
// Un tallo corto y recto del que salen dos hojas y media: una hoja grande,
// una chica y un brote nuevo apenas insinuado. Sin cara: la expresión está
// en la inclinación del tallo, no en dos ojitos. Es lo que la vuelve legible
// a 20 px y lo que la aleja de cualquier mascota de app.
//
// POR QUÉ ES UN SVG Y NO UNA IMAGEN
//
// Entra en el bundle que ya existe, hereda los tokens de color de la app y
// —si alguna vez se anima— se anima con los primitivos de movimiento.tsx y
// degrada solo con prefers-reduced-motion. Un GIF o un Lottie no degradan.
//
// SIEMPRE DECORATIVA
//
// aria-hidden fijo, sin escape: acompaña a un texto que ya dice todo. Si
// alguna vez Lupita queda sola, sin texto al lado, está mal puesta.
//
// SIN MOVIMIENTO
//
// Ninguno en esta versión, ni siquiera un fundido. Tampoco hay pose triste,
// de error ni de carga: en un error hablan las palabras (glosario.ts) y en
// una espera habla AnilloProgreso (movimiento.tsx).

import * as React from "react";

/** Las tres poses, y no hay una cuarta. */
export type PoseLupita = "saluda" | "senala" | "celebra";

/**
 * Los tres tamaños en los que se dibuja, y para qué sirve cada uno:
 *
 *   20 — inline, en una línea de ayuda o al lado de un mensaje de Lupita.
 *        A este tamaño va SIN el punto dorado del brote: el detalle chico
 *        ensucia en vez de sumar.
 *   32 — encabezado de un panel, de un paso de onboarding o de un toast.
 *   96 — estado vacío, dentro del círculo crema.
 *
 * El tipo es abierto (`number`) a propósito para no pelear con un caso
 * legítimo que aparezca después, pero fuera de estos tres no hay dibujo
 * pensado. El punto dorado se dibuja a partir de TAMANO_CON_DETALLE.
 */
export const TAMANOS_LUPITA = { inline: 20, encabezado: 32, vacio: 96 } as const;

/** Debajo de este tamaño no se dibuja el brote dorado. */
export const TAMANO_CON_DETALLE = 32;

/** El punto del brote, el único elemento relleno del dibujo. Mide 2 px. */
const RADIO_BROTE = 1;

/** El mismo peso de trazo que los íconos de la app. */
const TRAZO = 1.8;

interface FormaPose {
  /** El tallo, de la base a la punta. */
  tallo: string;
  /** Hoja grande, sage-500. */
  hojaGrande: string;
  /** Hoja chica, sage-300. Queda siempre del lado contrario a la grande. */
  hojaChica: string;
  /** Centro del punto dorado. */
  brote: { cx: number; cy: number };
}

// Las tres poses, dibujadas y no rotadas por transform: el trazo tiene que
// medir 1,8 px en las tres, y un `rotate` sobre el grupo entero le cambia el
// peso aparente al ojo cuando el ángulo no es múltiplo de 90.
const FORMAS: Record<PoseLupita, FormaPose> = {
  // Tallo vertical, hoja grande abierta a 45° a la izquierda, brote alto.
  saluda: {
    tallo: "M12 21.5V8.2",
    hojaGrande: "M12 15.4C8.5 15.4 5.7 12.9 5.1 9.2 8.8 9.7 11.6 11.9 12 15.4Z",
    hojaChica: "M12 12.2C14.4 12.2 16.4 10.5 16.8 7.9 14.3 8.2 12.3 9.7 12 12.2Z",
    brote: { cx: 12, cy: 6.4 },
  },
  // El tallo se inclina 12° hacia la derecha —el lado del contenido que
  // importa— y la hoja grande se estira en esa dirección. La chica queda
  // atrás, a la izquierda, como contrapeso.
  senala: {
    tallo: "M12 21.5C12.6 16.6 13.6 12.4 15 8.6",
    hojaGrande: "M13.6 14.9C17.1 14.4 19.4 11.4 19.4 7.7 15.8 8.7 13.4 11.3 13.6 14.9Z",
    hojaChica: "M13.2 11.6C10.9 11.2 9.2 9.3 9.1 6.7 11.4 7.3 13.1 9 13.2 11.6Z",
    brote: { cx: 15.6, cy: 6.9 },
  },
  // Las dos hojas arriba y el punto dorado separado 3 px de la punta del
  // tallo, como si acabara de abrirse. Nada de confeti ni de destellos.
  celebra: {
    tallo: "M12 21.5V9.4",
    hojaGrande: "M12 15C9.1 13.9 7.4 10.7 7.9 7 11.1 8.4 12.6 11.4 12 15Z",
    hojaChica: "M12 13.1C14.3 12.2 15.7 9.7 15.3 6.8 12.7 7.9 11.5 10.3 12 13.1Z",
    brote: { cx: 12, cy: 6.4 },
  },
};

export interface LupitaProps {
  pose: PoseLupita;
  /** Lado del dibujo en píxeles. Ver TAMANOS_LUPITA. */
  tamano?: number;
  className?: string;
}

/**
 * Lupita. `pose` dice qué está haciendo: neutro (saluda), apunta (señala) o
 * contento (celebra).
 *
 * El contenedor circular crema lo pone quien la usa, no el dibujo: a 20 px
 * va suelta en la línea de texto y a 96 px va dentro del círculo.
 */
export function Lupita({ pose, tamano = 32, className }: LupitaProps) {
  const forma = FORMAS[pose];
  const conBrote = tamano >= TAMANO_CON_DETALLE;

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-pose={pose}
      className={className}
    >
      <path
        d={forma.tallo}
        className="stroke-sage-500"
        strokeWidth={TRAZO}
        strokeLinecap="round"
      />
      <path
        d={forma.hojaGrande}
        className="stroke-sage-500"
        strokeWidth={TRAZO}
        strokeLinejoin="round"
      />
      <path
        d={forma.hojaChica}
        className="stroke-sage-300"
        strokeWidth={TRAZO}
        strokeLinejoin="round"
      />
      {conBrote ? (
        <circle
          data-brote="true"
          cx={forma.brote.cx}
          cy={forma.brote.cy}
          r={RADIO_BROTE}
          className="fill-gold-500"
        />
      ) : null}
    </svg>
  );
}
