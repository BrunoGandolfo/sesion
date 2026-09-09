// La marca de Sesión: el hilo.
//
// Tres cuentas de tamaño creciente enhebradas en una diagonal. Las sesiones
// se ensartan en un solo hilo y cada una es un poco más que la anterior —es
// EL_HILO del glosario, el contexto longitudinal que la app arrastra de
// sesión en sesión—. La decisión y el porqué están en
// docs/diseno/05-icono.md (propuesta A).
//
// POR QUÉ VIVE ACÁ Y NO EN CADA ARCHIVO
//
// icon.tsx y apple-icon.tsx dibujan lo mismo a distintos tamaños. Con el
// dibujo repetido en los dos, cualquier ajuste a la marca hay que acordarse
// de hacerlo dos veces, y la primera vez que uno se olvide el ícono de iOS y
// el favicon dejan de ser la misma marca.
//
// POR QUÉ FORMAS Y NO TEXTO
//
// ImageResponse dibuja con Satori, y Satori NO trae fuentes del sistema: si
// no se le pasa una en las opciones, un `fontFamily: "Georgia"` no dibuja
// nada. Es exactamente el error que tenían estos dos archivos —una "S" en
// Georgia— y el mismo que tenía el public/icon.svg que reemplazan. Un
// rectángulo, una línea y tres círculos no dependen de nada.

/** Lado del lienzo en el que está dibujada la marca. Todas las medidas de
 *  abajo son unidades de este lienzo, no píxeles. */
export const LIENZO = 64;

/** Salvia (sage-500), el fondo. */
export const SALVIA = "#4F7A6A";
/** Crema (cream-50), el hilo y las dos cuentas grandes. */
export const CREMA = "#FAFAF6";
/** Sage-300, la cuenta chica: la sesión más vieja es la que menos pesa. */
export const SAGE_300 = "#9BB6AA";

/** Los extremos del hilo, de abajo-izquierda a arriba-derecha. */
const HILO = { x1: 16, y1: 48, x2: 48, y2: 16 } as const;

/** Los centros de las tres cuentas, de la más vieja a la más nueva. */
const CENTROS = [
  { cx: 18, cy: 46 },
  { cx: 32, cy: 32 },
  { cx: 46, cy: 18 },
] as const;

export interface MedidasMarca {
  /** Grosor del hilo. */
  hilo: number;
  /** Radio de cada cuenta, en el orden de CENTROS. */
  cuentas: readonly [number, number, number];
  /** Radio de la esquina del fondo. */
  radioEsquina: number;
  /**
   * Cuánto se agranda el lienzo alrededor del dibujo. Con 0 la marca ocupa
   * el cuadrado entero; con 8 el viewBox pasa a medir 80 y la marca queda
   * ocupando 64/80 = 80 % del centro, que es la zona segura de un ícono
   * maskable de Android.
   */
  margen: number;
}

/**
 * Las medidas de la propuesta, tal como está dibujada en
 * docs/diseno/05-icono.md. Valen de 180 px para arriba.
 */
export const MEDIDAS_BASE: MedidasMarca = {
  hilo: 3.5,
  cuentas: [5, 6.5, 8],
  radioEsquina: 14,
  margen: 0,
};

/**
 * La variante chica, para el favicon de 32 px.
 *
 * El propio documento marcó el problema: a 32 px la cuenta menor se funde
 * con el hilo. La causa es la proporción entre las dos cosas —a ese tamaño
 * la cuenta chica mide 2,5 px de radio y el hilo 1,75 px de ancho, así que
 * la cuenta apenas sobresale—. Se corrige por los dos lados a la vez:
 * cuentas más gordas y hilo más fino, sin mover ningún centro. La
 * composición es la misma marca; cambia el peso, no el dibujo.
 *
 * Los números salen de mirar el PNG de 32 ampliado, no de estimar. Los
 * centros están a 19,8 unidades uno de otro, así que el hueco entre dos
 * cuentas es 19,8 menos sus dos radios: con estos radios quedan 5,8 y 3,3
 * unidades, que a 32 px son 2,9 y 1,65 px de hilo visible entre cuenta y
 * cuenta. Con las cuentas un punto más grandes (6,5 / 8 / 9,5) el hueco de
 * arriba caía a 1,15 px y las dos cuentas grandes se tocaban.
 */
export const MEDIDAS_CHICAS: MedidasMarca = {
  hilo: 2.2,
  cuentas: [6.5, 7.5, 9],
  radioEsquina: 14,
  margen: 0,
};

/**
 * La variante maskable de Android. Dos diferencias con la base:
 *
 *  - sin esquina redondeada: la máscara la pone el sistema, y un radio
 *    nuestro adentro del suyo deja un halo;
 *  - la marca al 80 %, porque Android puede recortar hasta un 20 % de cada
 *    borde y lo que quede afuera se pierde.
 */
export const MEDIDAS_MASKABLE: MedidasMarca = {
  ...MEDIDAS_BASE,
  radioEsquina: 0,
  margen: 8,
};

/** Cuál de los dos juegos de medidas le toca a un tamaño. */
export function medidasPara(lado: number): MedidasMarca {
  return lado <= 32 ? MEDIDAS_CHICAS : MEDIDAS_BASE;
}

/**
 * La marca, como SVG puro. Sin texto, sin fuentes, sin imágenes externas:
 * un rect, una línea y tres círculos.
 */
export function Marca({
  lado,
  medidas,
}: {
  lado: number;
  medidas: MedidasMarca;
}) {
  const { hilo, cuentas, radioEsquina, margen } = medidas;
  const vista = LIENZO + margen * 2;

  return (
    <svg
      width={lado}
      height={lado}
      viewBox={`${-margen} ${-margen} ${vista} ${vista}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x={-margen}
        y={-margen}
        width={vista}
        height={vista}
        rx={radioEsquina}
        fill={SALVIA}
      />
      <line
        x1={HILO.x1}
        y1={HILO.y1}
        x2={HILO.x2}
        y2={HILO.y2}
        stroke={CREMA}
        strokeWidth={hilo}
        strokeLinecap="round"
      />
      {CENTROS.map((centro, i) => (
        <circle
          key={i}
          cx={centro.cx}
          cy={centro.cy}
          r={cuentas[i]}
          fill={i === 0 ? SAGE_300 : CREMA}
        />
      ))}
    </svg>
  );
}
