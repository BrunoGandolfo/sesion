"use client";

import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";

// Primitivos de movimiento de la app. Siete, y ninguno decorativo:
//
//   Aparece         algo entró a la pantalla
//   ListaEnCascada  entró una lista, y se lee de arriba abajo
//   AlturaAnimada   esto se abrió (o se cerró) acá mismo
//   Contador        este número se acaba de calcular
//   Latido          esto está pasando ahora
//   CheckDibujado   lo que pediste se hizo
//   AnilloProgreso  esto está trabajando y no sabemos cuánto falta
//
// Duraciones entre 150 y 280 ms, salvo el Contador (600 ms, porque el
// número tiene que poder leerse mientras sube) y los dos indicadores
// continuos, que no son transiciones sino estado.
//
// La curva es siempre la misma, la que ya usa el resto de la app
// (--ease-out en globals.css). Sin rebotes: esto es la pantalla de una
// psicóloga entre sesión y sesión, no una app de fitness.
//
// prefers-reduced-motion: todos degradan a estático. No a "más rápido" ni a
// "un poquito menos": a estático. Quien pide menos movimiento por vértigo o
// migraña no quiere un fundido corto, quiere que no se mueva.

/**
 * La misma curva que --ease-out (globals.css). Es la única del proyecto: no
 * hay una curva "de entrada" y otra "de salida", ni una con rebote.
 *
 * Se exporta porque vivía copiada como literal en cinco archivos —el
 * template de página, el sheet, el toast y los dos menús—, y una curva
 * duplicada es una curva que en algún momento deja de ser la misma. Quien
 * necesite animar fuera de estos primitivos la importa de acá.
 */
export const SUAVE = [0.16, 1, 0.3, 1] as const;

const DURACION_APARECE = 0.24;
const DESPLAZAMIENTO = 6;

/** Milisegundos entre un hijo y el siguiente en una cascada. */
export const PASO_CASCADA_MS = 40;

/**
 * Cuántos elementos animan como máximo. A partir del noveno la lista entra
 * estática: encadenar cuarenta retrasos hace que el último aparezca casi dos
 * segundos después, y a esa altura ya no se lee como entrada sino como lag.
 */
export const MAXIMO_EN_CASCADA = 8;

// Elementos sobre los que se puede montar movimiento. La lista es corta a
// propósito: un `motion.li` dentro de un `ul` y un `motion.div` suelto
// cubren todo lo que la app necesita, y evitan que un wrapper de más rompa
// la semántica de una lista.
const ELEMENTOS = {
  div: motion.div,
  ul: motion.ul,
  li: motion.li,
  section: motion.section,
  span: motion.span,
} as const;

export type ElementoMovimiento = keyof typeof ELEMENTOS;

// ────────────────────────────────────────────────────────────────────────────
// Aparece
// ────────────────────────────────────────────────────────────────────────────

export interface ApareceProps {
  children: React.ReactNode;
  /** Segundos de espera antes de entrar. Lo usa ListaEnCascada. */
  retraso?: number;
  /** Etiqueta a renderizar. `li` cuando el padre es una lista. */
  como?: ElementoMovimiento;
  /** false para renderizar la etiqueta sin animar (ítem fuera del tope). */
  animar?: boolean;
  className?: string;
}

/**
 * Fundido con 6 px de desplazamiento hacia arriba. Es la entrada por
 * defecto de cualquier bloque que aparece después de una carga.
 */
export function Aparece({
  children,
  retraso = 0,
  como = "div",
  animar = true,
  className,
}: ApareceProps) {
  const reducido = useReducedMotion();
  const Elemento = ELEMENTOS[como];
  const quieto = reducido || !animar;

  return (
    <Elemento
      className={className}
      initial={quieto ? false : { opacity: 0, y: DESPLAZAMIENTO }}
      animate={quieto ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: DURACION_APARECE, ease: SUAVE, delay: retraso }}
    >
      {children}
    </Elemento>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ListaEnCascada
// ────────────────────────────────────────────────────────────────────────────

export interface ListaEnCascadaProps {
  children: React.ReactNode;
  /** Etiqueta del contenedor. */
  contenedor?: ElementoMovimiento;
  /** Etiqueta de cada ítem. `li` si el contenedor es una lista. */
  item?: ElementoMovimiento;
  /** Milisegundos entre ítems. */
  pasoMs?: number;
  /** Cuántos ítems animan antes de que el resto entre estático. */
  maximo?: number;
  className?: string;
  /** Para que un `aria-controls` pueda apuntar al contenedor. */
  id?: string;
}

/**
 * Entrada escalonada. Todos los hijos se envuelven en la misma etiqueta
 * (animen o no), así el DOM no cambia de forma según la posición: una lista
 * de treinta sesiones sigue siendo treinta `li`, con los ocho primeros
 * animados y el resto quietos.
 */
export function ListaEnCascada({
  children,
  contenedor = "div",
  item = "div",
  pasoMs = PASO_CASCADA_MS,
  maximo = MAXIMO_EN_CASCADA,
  className,
  id,
}: ListaEnCascadaProps) {
  const Contenedor = ELEMENTOS[contenedor];
  const hijos = React.Children.toArray(children).filter(React.isValidElement);

  return (
    <Contenedor id={id} className={className}>
      {hijos.map((hijo, indice) => (
        <Aparece
          key={hijo.key ?? indice}
          como={item}
          animar={indice < maximo}
          retraso={(indice * pasoMs) / 1000}
        >
          {hijo}
        </Aparece>
      ))}
    </Contenedor>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AlturaAnimada
// ────────────────────────────────────────────────────────────────────────────

/** Lo que tarda un bloque en abrirse o cerrarse, en milisegundos. Se
 *  exporta para que quien tenga que esperar al despliegue —el foco de
 *  Confirmar, sin ir más lejos— no lo copie. */
export const MS_PLIEGUE = 220;

/** Lo mismo en segundos, que es como lo pide framer-motion. */
const DURACION_PLIEGUE = MS_PLIEGUE / 1000;

export interface AlturaAnimadaProps {
  /** Estado del bloque. El componente anima la transición entre los dos. */
  abierto: boolean;
  /**
   * Animar también la primera aparición, cuando el bloque ya nace abierto.
   *
   * Por defecto no: un plegable que arranca desplegado tiene que estar
   * dibujado en el primer cuadro, no abrirse solo cada vez que se monta la
   * pantalla. Lo pide quien se monta *por* haberse abierto —Confirmar, que
   * aparece cuando ella tocó el botón—: ahí el montaje es la apertura.
   */
  alMontar?: boolean;
  children: React.ReactNode;
  /** Para que el `aria-controls` del disparador pueda apuntar al panel. */
  id?: string;
  /** Clases del contenido. Van adentro del recorte, no en el que anima: la
   *  altura se mide sobre el contenido con su padding real. */
  className?: string;
}

/**
 * Un bloque que se pliega y se despliega con su altura, en vez de aparecer y
 * desaparecer de golpe. Es lo que hace que la nota no "salte" cuando se abre
 * "Más de esta sesión": el ojo ve de dónde salió el bloque y qué se corrió
 * para abajo.
 *
 * `height: auto` es el único caso en que animar una propiedad de layout vale
 * la pena: no hay número que poner —el contenido mide lo que mide— y
 * framer-motion lo resuelve midiendo, no forzando un alto fijo que después
 * recorte el texto.
 *
 * Con la preferencia de movimiento reducido no hay transición ni recorte: el
 * bloque está o no está, que es exactamente lo que hacía antes.
 */
export function AlturaAnimada({
  abierto,
  alMontar = false,
  children,
  id,
  className,
}: AlturaAnimadaProps) {
  const reducido = useReducedMotion();

  if (reducido) {
    return abierto ? (
      <div id={id} className={className}>
        {children}
      </div>
    ) : null;
  }

  return (
    <AnimatePresence initial={alMontar}>
      {abierto ? (
        <motion.div
          id={id}
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: DURACION_PLIEGUE, ease: SUAVE }}
          style={{ overflow: "hidden" }}
        >
          <div className={className}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Contador
// ────────────────────────────────────────────────────────────────────────────

export interface ContadorProps {
  /** El número al que se llega. */
  valor: number;
  /** Cómo se escribe cada paso. Recibe el valor ya redondeado. */
  formato?: (n: number) => string;
  /** Segundos que tarda en llegar. */
  duracion?: number;
  className?: string;
}

/**
 * Cuenta de 0 al valor. Sirve para los tres números de Hoy: que suban dice
 * "esto se acaba de calcular", y de paso el ojo se apoya en ellos antes de
 * seguir bajando.
 *
 * Con la preferencia de movimiento reducido muestra el número final y listo.
 */
export function Contador({
  valor,
  formato = (n) => String(n),
  duracion = 0.6,
  className,
}: ContadorProps) {
  const reducido = useReducedMotion();
  const progreso = useMotionValue(0);
  const texto = useTransform(progreso, (n) => formato(Math.round(n)));

  React.useEffect(() => {
    if (reducido) {
      progreso.set(valor);
      return;
    }
    // `animate` escribe en un MotionValue, no en el estado de React: el
    // componente no re-renderiza en cada cuadro.
    const control = animate(progreso, valor, { duration: duracion, ease: SUAVE });
    return () => control.stop();
  }, [valor, duracion, reducido, progreso]);

  if (reducido) {
    return <span className={className}>{formato(valor)}</span>;
  }

  return <motion.span className={className}>{texto}</motion.span>;
}

// ────────────────────────────────────────────────────────────────────────────
// Latido
// ────────────────────────────────────────────────────────────────────────────

export interface LatidoProps {
  /** Lado del punto, en píxeles. */
  tamano?: number;
  /** Clase con el color de fondo. */
  className?: string;
  /** Texto para lectores de pantalla; sin él, el punto es decorativo. */
  etiqueta?: string;
}

/**
 * Punto que pulsa despacio: "esto está pasando ahora". Se usa en la sesión
 * en curso y en el indicador REC de la grabación.
 *
 * El ciclo es de 1,8 s y la opacidad no baja de 0,45: un parpadeo marcado
 * a un metro de distancia se lee como alarma, y esto no es una alarma.
 */
export function Latido({ tamano = 8, className = "", etiqueta }: LatidoProps) {
  const reducido = useReducedMotion();
  const estilo = { width: tamano, height: tamano };
  const clases = `inline-block shrink-0 rounded-full ${className}`;

  if (reducido) {
    return (
      <span
        className={clases}
        style={estilo}
        role={etiqueta ? "img" : undefined}
        aria-label={etiqueta}
        aria-hidden={etiqueta ? undefined : true}
      />
    );
  }

  return (
    <motion.span
      className={clases}
      style={estilo}
      role={etiqueta ? "img" : undefined}
      aria-label={etiqueta}
      aria-hidden={etiqueta ? undefined : true}
      animate={{ opacity: [1, 0.45, 1], scale: [1, 1.18, 1] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CheckDibujado
// ────────────────────────────────────────────────────────────────────────────

export interface CheckDibujadoProps {
  tamano?: number;
  className?: string;
}

/**
 * El check se traza en 300 ms en vez de aparecer de golpe. Es la
 * confirmación de que algo se guardó: cobrar, aprobar una nota. El trazo
 * dura lo justo para que el ojo lo siga y entienda que pasó algo, sin
 * retrasar la lectura del texto que lo acompaña.
 */
export function CheckDibujado({ tamano = 16, className }: CheckDibujadoProps) {
  const reducido = useReducedMotion();

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <motion.path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reducido ? false : { pathLength: 0, opacity: 0 }}
        animate={reducido ? undefined : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: SUAVE }}
      />
    </svg>
  );
}

/** Lo que tarda el trazo del check, en milisegundos. */
export const MS_CHECK_DIBUJADO = 300;

/** Un respiro después del trazo, para que el ojo lo termine de leer. */
const MS_RESPIRO = 120;

/**
 * "Lo que pediste se hizo, acá donde lo pediste."
 *
 * Sostiene abierto un panel el tiempo justo para que el check se trace y
 * después llama a `alTerminar` (que en la práctica es cerrar el sheet). Sin
 * esto, el sheet del cobro se cierra apenas responde la API —a veces en 150
 * ms— y el trazo se corta por la mitad: la confirmación queda solo en el
 * toast, abajo de todo, lejos del dedo que acaba de tocar el método.
 *
 * Con prefers-reduced-motion no hay trazo que esperar: cierra en el acto,
 * exactamente como antes.
 *
 * Devuelve el par [valor confirmado, confirmar] al estilo useState: `null`
 * mientras no hay confirmación, y el valor confirmado mientras se dibuja.
 */
export function useConfirmacionDibujada<T>(
  alTerminar: () => void,
): readonly [T | null, (valor: T) => void] {
  const [confirmado, setConfirmado] = React.useState<T | null>(null);
  const reducido = useReducedMotion();

  // El callback se guarda en un ref y no en las dependencias del efecto:
  // los consumidores lo pasan inline (`() => setCobroTarget(null)`), así que
  // cambia de identidad en cada render y reiniciaría el temporizador para
  // siempre.
  const alTerminarRef = React.useRef(alTerminar);
  React.useEffect(() => {
    alTerminarRef.current = alTerminar;
  }, [alTerminar]);

  React.useEffect(() => {
    if (confirmado === null) return;
    const espera = reducido ? 0 : MS_CHECK_DIBUJADO + MS_RESPIRO;
    const timer = window.setTimeout(() => {
      setConfirmado(null);
      alTerminarRef.current();
    }, espera);
    return () => window.clearTimeout(timer);
  }, [confirmado, reducido]);

  return [confirmado, setConfirmado] as const;
}

// ────────────────────────────────────────────────────────────────────────────
// AnilloProgreso
// ────────────────────────────────────────────────────────────────────────────

export interface AnilloProgresoProps {
  tamano?: number;
  className?: string;
  /** Qué está pasando, para lectores de pantalla. */
  etiqueta?: string;
}

/**
 * Indeterminado: gira mientras el worker escribe la nota. No promete un
 * porcentaje que no tenemos —la transcripción y el modelo no informan
 * avance— así que no dibuja una barra que se llena sola.
 *
 * Con movimiento reducido queda quieto: sigue siendo un anillo incompleto,
 * que ya dice "falta algo", y el texto de al lado dice qué.
 */
export function AnilloProgreso({
  tamano = 18,
  className,
  etiqueta,
}: AnilloProgresoProps) {
  const reducido = useReducedMotion();

  return (
    <motion.svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role={etiqueta ? "img" : undefined}
      aria-label={etiqueta}
      aria-hidden={etiqueta ? undefined : true}
      animate={reducido ? undefined : { rotate: 360 }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2.2}
        opacity={0.22}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </motion.svg>
  );
}
