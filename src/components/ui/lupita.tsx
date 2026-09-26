// Lupita, el brote. El personaje de la app, dibujado a mano sobre la grilla
// de 24 (docs/diseno/04-personaje.md, concepto A; su presencia en las
// pantallas, en docs/diseno/06-lupita-presencia.md).
//
// Un tallo corto y recto del que salen dos hojas y media: una hoja grande,
// una chica y un brote nuevo apenas insinuado. Sin cara, y sin ojos (06,
// D1): la expresión está en la inclinación del tallo, no en dos ojitos. Es
// lo que la vuelve legible a 20 px y lo que la aleja de cualquier mascota de
// app. Hasta el parpadeo es de la hoja chica, que se pliega un instante.
//
// POR QUÉ ES UN SVG Y NO UNA IMAGEN
//
// Entra en el bundle que ya existe, hereda los tokens de color de la app, se
// anima con framer-motion y degrada solo con prefers-reduced-motion. Un GIF
// o un Lottie no degradan.
//
// SIEMPRE DECORATIVA
//
// aria-hidden fijo, sin escape: acompaña a un texto que ya dice todo. Si
// alguna vez Lupita queda sola, sin texto al lado, está mal puesta. (La
// posada, que no lleva texto, es un atajo de puntero a un ítem del menú que
// sí lo lleva: layout/presencia-lupita.tsx.)

import * as React from "react";
import { motion, type TargetAndTransition, type Transition } from "framer-motion";

import { useMovimientoReducido } from "@/hooks/useMovimientoReducido";
import { anotarLupitaViva, obtenerParpadeo, suscribirParpadeo } from "@/lib/lupita-presencia";
import { SUAVE, TIEMPOS, TIEMPOS_LUPITA } from "@/lib/movimiento";

/**
 * Las siete poses (06, sección 1). Las tres primeras son las de siempre;
 * las otras cuatro son cuadros de un gesto o de un estado:
 *
 *   saluda-alto  — el cuadro del medio del saludo (la hoja grande levantada).
 *   concentrada  — "sentada" junto a la nota que se está escribiendo.
 *   piensa       — el otro extremo del vaivén del chat (el primero es senala).
 *   asiente      — el cuadro del medio de un "sí" con la cabeza.
 */
export type PoseLupita =
  | "saluda"
  | "senala"
  | "celebra"
  | "saluda-alto"
  | "concentrada"
  | "piensa"
  | "asiente";

/**
 * Los tamaños en los que se dibuja, y para qué sirve cada uno:
 *
 *   20 — inline, en una línea de ayuda o en el ítem del menú.
 *        A este tamaño va SIN el punto dorado del brote: el detalle chico
 *        ensucia en vez de sumar. Y nunca se mueve.
 *   32 — junto al "procesando" de Hoy y al recordatorio de Grabar.
 *   34 — la posada (LADO_POSADA en lib/lupita-presencia.ts).
 *   72 — encabezado del panel de ayuda y vacío de Hoy.
 *   96 — estado vacío, dentro del círculo crema.
 *
 * El tipo es abierto (`number`) a propósito, pero fuera de estos no hay
 * dibujo pensado. El punto dorado —y el movimiento en reposo— empiezan en
 * TAMANO_CON_DETALLE.
 */
export const TAMANOS_LUPITA = { inline: 20, junto: 32, encabezado: 72, vacio: 96 } as const;

/** Debajo de este tamaño no se dibuja el brote dorado, y no respira ni
 *  parpadea: a 20 px el movimiento es un temblor de antialias. */
export const TAMANO_CON_DETALLE = 32;

/** El punto del brote, el único elemento relleno del dibujo. Mide 2 px. */
const RADIO_BROTE = 1;

/** El mismo peso de trazo que los íconos de la app. */
const TRAZO = 1.8;

// ─── Las formas ─────────────────────────────────────────────────────────────
//
// Todas las poses se escriben con los MISMOS comandos, para que cualquiera
// pueda morfar hacia cualquier otra (framer-motion interpola un `d` sólo si
// los dos tienen la misma forma; si no, salta):
//
//   tallo — una sola cúbica: M x y C x1 y1 x2 y2 x y. Un tallo recto es una
//           cúbica con los controles sobre la recta: se ve igual.
//   hoja  — dos cúbicas que vuelven a la base: M b C c1 c2 punta c3 c4 b Z.
//
// Dibujadas y no rotadas por transform: el trazo tiene que medir 1,8 px en
// todas, y un `rotate` sobre el grupo entero le cambia el peso aparente al
// ojo cuando el ángulo no es múltiplo de 90. Por eso los números están acá
// y no se calculan con un ángulo. El test de firmas
// (__tests__/lupita-formas.test.ts) falla si una pose rompe la forma común.

type Tallo = readonly [number, number, number, number, number, number, number, number];
type Hoja = readonly [
  number, number,
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

interface FormaPose {
  tallo: Tallo;
  /** Hoja grande, sage-500. */
  hojaGrande: Hoja;
  /** Hoja chica, sage-300. */
  hojaChica: Hoja;
  /** Centro del punto dorado. */
  brote: { cx: number; cy: number };
}

const FORMAS: Record<PoseLupita, FormaPose> = {
  // Tallo vertical, hoja grande abierta a 45° a la izquierda, brote alto.
  // Es también el reposo.
  saluda: {
    tallo: [12, 21.5, 12, 17.07, 12, 12.63, 12, 8.2],
    hojaGrande: [12, 15.4, 8.5, 15.4, 5.7, 12.9, 5.1, 9.2, 8.8, 9.7, 11.6, 11.9, 12, 15.4],
    hojaChica: [12, 12.2, 14.4, 12.2, 16.4, 10.5, 16.8, 7.9, 14.3, 8.2, 12.3, 9.7, 12, 12.2],
    brote: { cx: 12, cy: 6.4 },
  },
  // El tallo se inclina 12° hacia la derecha —el lado del contenido que
  // importa— y la hoja grande se estira en esa dirección. La chica queda
  // atrás, a la izquierda, como contrapeso.
  senala: {
    tallo: [12, 21.5, 12.6, 16.6, 13.6, 12.4, 15, 8.6],
    hojaGrande: [13.6, 14.9, 17.1, 14.4, 19.4, 11.4, 19.4, 7.7, 15.8, 8.7, 13.4, 11.3, 13.6, 14.9],
    hojaChica: [13.2, 11.6, 10.9, 11.2, 9.2, 9.3, 9.1, 6.7, 11.4, 7.3, 13.1, 9, 13.2, 11.6],
    brote: { cx: 15.6, cy: 6.9 },
  },
  // Las dos hojas arriba y el punto dorado separado 3 px de la punta del
  // tallo, como si acabara de abrirse. Nada de confeti ni de destellos.
  celebra: {
    tallo: [12, 21.5, 12, 17.47, 12, 13.43, 12, 9.4],
    hojaGrande: [12, 15, 9.1, 13.9, 7.4, 10.7, 7.9, 7, 11.1, 8.4, 12.6, 11.4, 12, 15],
    hojaChica: [12, 13.1, 14.3, 12.2, 15.7, 9.7, 15.3, 6.8, 12.7, 7.9, 11.5, 10.3, 12, 13.1],
    brote: { cx: 12, cy: 6.4 },
  },
  // Como saluda, pero la hoja grande sube por encima de la horizontal, casi
  // vertical, como una mano levantada. El tallo se endereza medio punto.
  "saluda-alto": {
    tallo: [12, 21.5, 12, 16.97, 12, 12.43, 12, 7.9],
    hojaGrande: [12, 15.4, 8.4, 15.2, 6.6, 10.8, 7.6, 5.6, 10.4, 7.2, 12.2, 10.8, 12, 15.4],
    hojaChica: [12, 12.2, 14.4, 12.2, 16.4, 10.5, 16.8, 7.9, 14.3, 8.2, 12.3, 9.7, 12, 12.2],
    brote: { cx: 12, cy: 6.1 },
  },
  // "Sentada": tallo un 25 % más corto (la base no se mueve) y curvado hacia
  // el texto de al lado; la hoja grande plegada contra el tallo, como brazos
  // cruzados; la chica casi cerrada; el brote más bajo. Se lee "está
  // trabajando", no "está triste".
  concentrada: {
    tallo: [12, 21.5, 12, 18.6, 12.6, 15.4, 14, 13],
    hojaGrande: [12.4, 17.6, 14.6, 17.8, 16.4, 16.2, 16.6, 13.6, 14.8, 13.9, 12.9, 15.3, 12.4, 17.6],
    hojaChica: [12.3, 16.2, 10.9, 16.2, 9.6, 15.2, 9.3, 13.6, 10.6, 13.7, 11.8, 14.6, 12.3, 16.2],
    brote: { cx: 14.6, cy: 11.2 },
  },
  // Espejo parcial de senala: el tallo se inclina 8° a la izquierda, la hoja
  // grande recogida hacia arriba, la chica abierta a la derecha. Sola no se
  // usa: es el otro extremo del vaivén del chat.
  piensa: {
    tallo: [12, 21.5, 11.6, 16.8, 10.9, 12.6, 10, 8.8],
    hojaGrande: [10.6, 14.8, 8.6, 13.8, 7.8, 10.8, 8.2, 7.6, 10.2, 8.9, 11.1, 11.6, 10.6, 14.8],
    hojaChica: [10.9, 12.4, 13.2, 12.7, 15.2, 11.6, 15.8, 9.6, 13.6, 9.5, 11.6, 10.4, 10.9, 12.4],
    brote: { cx: 9.6, cy: 7.1 },
  },
  // La mitad de arriba del tallo se dobla 15° hacia adelante y el brote baja
  // 1,5; las hojas bajan con él sin cerrarse.
  asiente: {
    tallo: [12, 21.5, 12, 17.2, 12.3, 13.1, 13.8, 9.8],
    hojaGrande: [12.1, 16.2, 8.6, 16.2, 5.9, 13.8, 5.4, 10.2, 9, 10.6, 11.7, 12.7, 12.1, 16.2],
    hojaChica: [12.2, 13.2, 14.6, 13.3, 16.6, 11.7, 17.1, 9.1, 14.6, 9.3, 12.6, 10.8, 12.2, 13.2],
    brote: { cx: 14.4, cy: 7.9 },
  },
};

/** Cuánto de su ancho conserva la hoja chica plegada: casi nada, queda de
 *  canto sobre su nervio. */
const ABIERTA_AL_PLEGAR = 0.15;

/** La hoja chica plegada (06, D1: el parpadeo). La misma forma, con los
 *  cuatro controles llevados casi sobre la recta que une la base y la punta:
 *  por eso morfa con la abierta y no hace falta dibujarla a mano. */
export function plegar(hoja: Hoja): Hoja {
  const [bx, by, , , , , px, py] = hoja;
  const sobreNervio = (x: number, y: number, t: number): [number, number] => {
    const nx = bx + (px - bx) * t;
    const ny = by + (py - by) * t;
    return [nx + (x - nx) * ABIERTA_AL_PLEGAR, ny + (y - ny) * ABIERTA_AL_PLEGAR];
  };
  const [c1x, c1y] = sobreNervio(hoja[2], hoja[3], 1 / 3);
  const [c2x, c2y] = sobreNervio(hoja[4], hoja[5], 2 / 3);
  const [c3x, c3y] = sobreNervio(hoja[8], hoja[9], 2 / 3);
  const [c4x, c4y] = sobreNervio(hoja[10], hoja[11], 1 / 3);
  return [bx, by, c1x, c1y, c2x, c2y, px, py, c3x, c3y, c4x, c4y, bx, by];
}

const num = (v: number) => String(Math.round(v * 100) / 100);

function trazoTallo(t: Tallo): string {
  return `M${num(t[0])} ${num(t[1])}C${t.slice(2).map(num).join(" ")}`;
}

function trazoHoja(h: Hoja): string {
  return `M${num(h[0])} ${num(h[1])}C${h.slice(2).map(num).join(" ")}Z`;
}

export const POSES_LUPITA = Object.keys(FORMAS) as PoseLupita[];

/** Los tres trazos de una pose, listos para `d`. Lo usa también el test de
 *  firmas. */
export function trazosDe(pose: PoseLupita, chicaPlegada = false) {
  const forma = FORMAS[pose];
  return {
    tallo: trazoTallo(forma.tallo),
    hojaGrande: trazoHoja(forma.hojaGrande),
    hojaChica: trazoHoja(chicaPlegada ? plegar(forma.hojaChica) : forma.hojaChica),
  };
}

// ─── El movimiento ──────────────────────────────────────────────────────────

/** Gestos finitos; el panel usa las mismas duraciones para su secuencia. */
export const DURACION_BROTA = TIEMPOS.pliegue / 1000;
export const DURACION_CELEBRA = TIEMPOS.pliegue / 1000;
export const DURACION_TOQUE_MENU = TIEMPOS.breve / 1000;
/** Saludo y cobro: ida y vuelta, 450 ms. */
export const DURACION_GESTO = TIEMPOS_LUPITA.gesto / 1000;
/** Asiente: el mismo gesto un poco más corto (06, sección 3: ~400 ms). */
export const DURACION_ASIENTE = (TIEMPOS_LUPITA.gesto * 0.9) / 1000;

/** El vaivén del chat: semiciclos de 900 ms hasta el tope de 15 s. Es
 *  finito a propósito —pasado el tope queda `senala` quieta—, y con un
 *  número par de semiciclos termina donde empezó. */
export const SEMICICLOS_PIENSA = 2 * Math.floor(15_000 / TIEMPOS_LUPITA.pensamiento / 2);

/**
 * Qué está haciendo:
 *
 *   quieta   — nada.
 *   respira  — reposo: respira y parpadea, sólo desde 32 px (06, sección 3).
 *   brota    — aparece subiendo, 220 ms.
 *   retira   — el brota al revés: se va bajando, 220 ms.
 *   celebra  — pasa a `celebra` y se queda (el final de una respuesta).
 *   piensa   — vaivén `senala ↔ piensa` (el chat esperando).
 *   habla    — `senala` quieta: lo que se mueve es el texto.
 *   saludo   — saluda → saluda-alto → saluda, 450 ms.
 *   cobro    — saluda → celebra → saluda, 450 ms.
 *   asiente  — saluda → asiente → saluda, ~400 ms.
 */
export type MovimientoLupita =
  | "quieta"
  | "respira"
  | "brota"
  | "retira"
  | "celebra"
  | "piensa"
  | "habla"
  | "saludo"
  | "cobro"
  | "asiente";

type Gesto = "saludo" | "cobro" | "asiente";
const CUADRO_DEL_MEDIO: Record<Gesto, PoseLupita> = {
  saludo: "saluda-alto",
  cobro: "celebra",
  asiente: "asiente",
};
export const DURACION_DE_GESTO: Record<Gesto, number> = {
  saludo: DURACION_GESTO,
  cobro: DURACION_GESTO,
  asiente: DURACION_ASIENTE,
};
function esGesto(m: MovimientoLupita): m is Gesto {
  return m === "saludo" || m === "cobro" || m === "asiente";
}

type Entrada = "brota" | "celebra" | "retira";
const ENTRADA: Record<Entrada, { initial: TargetAndTransition; animate: TargetAndTransition }> = {
  brota: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } },
  celebra: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } },
  retira: { initial: { opacity: 1, y: 0 }, animate: { opacity: 0, y: 4 } },
};
function esEntrada(m: MovimientoLupita): m is Entrada {
  return m === "brota" || m === "celebra" || m === "retira";
}
const TRANSICION: Transition = { duration: DURACION_CELEBRA, ease: SUAVE };

export interface LupitaProps {
  pose: PoseLupita;
  /** Lado del dibujo en píxeles. Ver TAMANOS_LUPITA. */
  tamano?: number;
  className?: string;
  movimiento?: MovimientoLupita;
  /** Se conserva la prop del panel; recibir texto no reinicia un gesto. */
  pulso?: number;
  /** Sube en cada gesto para repetirlo aunque sea del mismo tipo. */
  vez?: number;
  /** La posada no cuenta como "Lupita de contenido": es la que se queda
   *  quieta cuando hay otra viva, no la que la aquieta. */
  enPosada?: boolean;
}

const sinSuscripcion = () => () => {};
const cero = () => 0;

/** Una Lupita de contenido que respira se anota en el almacén mientras está
 *  a la vista, para que la posada se quede quieta (una sola viva). */
function useAnotarViva(nodo: React.RefObject<SVGSVGElement | null>, activa: boolean) {
  React.useEffect(() => {
    const svg = nodo.current;
    if (!activa || !svg) return;
    let anotada = false;
    const poner = (visible: boolean) => {
      if (visible === anotada) return;
      anotada = visible;
      anotarLupitaViva(visible ? 1 : -1);
    };
    if (typeof IntersectionObserver === "undefined") {
      poner(true);
      return () => poner(false);
    }
    const observador = new IntersectionObserver(([entrada]) => poner(entrada.isIntersecting));
    observador.observe(svg);
    return () => {
      observador.disconnect();
      poner(false);
    };
  }, [nodo, activa]);
}

/**
 * Lupita. `pose` dice qué está haciendo en quieto; `movimiento`, cómo se
 * mueve. Con prefers-reduced-motion no se mueve nada: los estados se ven en
 * su pose fija y los gestos no se ven (06, sección 3).
 *
 * El contenedor circular crema lo pone quien la usa, no el dibujo.
 */
export function Lupita({
  pose,
  tamano = 32,
  className,
  movimiento = "quieta",
  vez = 0,
  enPosada = false,
}: LupitaProps) {
  const reducido = useMovimientoReducido();
  const conDetalle = tamano >= TAMANO_CON_DETALLE;
  const vive = !reducido && conDetalle && movimiento === "respira";
  const svg = React.useRef<SVGSVGElement>(null);
  useAnotarViva(svg, vive && !enPosada);

  // El parpadeo: sólo las vivas se suscriben al reloj. El valor del reloj
  // cuando empezó a vivir no cuenta —una Lupita que aparece no arranca
  // guiñando—: parpadea con el siguiente.
  const parpadeo = React.useSyncExternalStore(
    vive ? suscribirParpadeo : sinSuscripcion,
    vive ? obtenerParpadeo : cero,
    cero,
  );
  const [base, setBase] = React.useState<number | null>(null);
  const baseEsperada = vive ? (base ?? parpadeo) : null;
  if (baseEsperada !== base) setBase(baseEsperada);
  const parpadea = vive && base !== null && parpadeo !== base;

  const poseVisible: PoseLupita =
    movimiento === "piensa" || movimiento === "habla" ? "senala"
      : movimiento === "celebra" ? "celebra"
        : pose;
  const forma = FORMAS[poseVisible];
  const trazos = trazosDe(poseVisible);

  // Gestos y vaivén: una secuencia de poses por la que pasan JUNTOS los tres
  // trazos y el punto dorado, con la misma transición. Si el brote no
  // viajara con el tallo, en `piensa` quedaría flotando a 17 px de la punta.
  const secuencia: { poses: PoseLupita[]; transition: Transition; clave: string } | null =
    reducido ? null
      : esGesto(movimiento) ? {
          poses: [poseVisible, CUADRO_DEL_MEDIO[movimiento], poseVisible],
          transition: { duration: DURACION_DE_GESTO[movimiento], ease: SUAVE, times: [0, 0.5, 1] },
          clave: `${movimiento}-${vez}`,
        }
        : movimiento === "piensa" ? {
            poses: ["senala", "piensa"],
            transition: {
              duration: TIEMPOS_LUPITA.pensamiento / 1000,
              ease: SUAVE,
              repeat: SEMICICLOS_PIENSA - 1,
              repeatType: "reverse",
            },
            clave: "piensa",
          }
          : null;

  function trazo(parte: "tallo" | "hojaGrande" | "hojaChica") {
    const atributos = parte === "tallo"
      ? { className: "stroke-sage-500", strokeWidth: TRAZO, strokeLinecap: "round" as const }
      : {
          className: parte === "hojaGrande" ? "stroke-sage-500" : "stroke-sage-300",
          strokeWidth: TRAZO,
          strokeLinejoin: "round" as const,
        };
    if (reducido) return <path key={parte} {...atributos} d={trazos[parte]} />;

    if (secuencia) {
      const d = secuencia.poses.map((p) => trazosDe(p)[parte]);
      return (
        <motion.path
          key={`${parte}-${secuencia.clave}`}
          {...atributos}
          initial={{ d: d[0] }}
          animate={{ d }}
          transition={secuencia.transition}
        />
      );
    }
    if (movimiento === "celebra" && parte !== "tallo") {
      return (
        <motion.path
          key={parte}
          {...atributos}
          initial={{ d: trazosDe("saluda")[parte] }}
          animate={{ d: trazos[parte] }}
          transition={{ duration: DURACION_CELEBRA, ease: SUAVE }}
        />
      );
    }
    if (parte === "hojaChica" && parpadea) {
      const plegada = trazosDe(poseVisible, true).hojaChica;
      return (
        <motion.path
          key={`chica-${parpadeo}`}
          {...atributos}
          data-parpadeo={parpadeo}
          initial={{ d: trazos.hojaChica }}
          animate={{ d: [trazos.hojaChica, plegada, trazos.hojaChica] }}
          transition={{ duration: TIEMPOS_LUPITA.parpadeo / 1000, ease: SUAVE, times: [0, 0.5, 1] }}
        />
      );
    }
    return <path key={parte} {...atributos} d={trazos[parte]} />;
  }

  const clases = [className, vive ? "lupita-respira" : null].filter(Boolean).join(" ");
  const dibujo = (
    <svg
      ref={svg}
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-pose={poseVisible}
      data-vive={vive ? "true" : undefined}
      className={clases === "" ? undefined : clases}
    >
      {trazo("tallo")}
      {trazo("hojaGrande")}
      {trazo("hojaChica")}
      {!conDetalle ? null : secuencia ? (
        <motion.circle
          key={`brote-${secuencia.clave}`}
          data-brote="true"
          r={RADIO_BROTE}
          className="fill-gold-500"
          initial={{ cx: forma.brote.cx, cy: forma.brote.cy }}
          animate={{
            cx: secuencia.poses.map((p) => FORMAS[p].brote.cx),
            cy: secuencia.poses.map((p) => FORMAS[p].brote.cy),
          }}
          transition={secuencia.transition}
        />
      ) : (
        <circle
          data-brote="true"
          cx={forma.brote.cx}
          cy={forma.brote.cy}
          r={RADIO_BROTE}
          className="fill-gold-500"
        />
      )}
    </svg>
  );

  if (reducido || !esEntrada(movimiento)) return dibujo;

  return (
    <motion.span
      key={movimiento}
      aria-hidden="true"
      data-movimiento={movimiento}
      className="inline-flex origin-bottom"
      initial={ENTRADA[movimiento].initial}
      animate={ENTRADA[movimiento].animate}
      transition={TRANSICION}
    >
      {dibujo}
    </motion.span>
  );
}

/** Única reacción del menú: el botón incrementa toque, también con teclado.
 * No cambia estados del panel ni activa sus loops. */
export function LupitaMenu({ toque }: { toque: number }) {
  const reducido = useMovimientoReducido();
  const dibujo = <Lupita pose="saluda" tamano={TAMANOS_LUPITA.inline} />;
  if (reducido) return dibujo;
  return (
    <motion.span
      key={toque}
      aria-hidden="true"
      className="inline-flex"
      initial={{ y: 0 }}
      animate={{ y: toque === 0 ? 0 : [0, -3, 0] }}
      transition={{ duration: DURACION_TOQUE_MENU, ease: SUAVE }}
    >
      {dibujo}
    </motion.span>
  );
}
