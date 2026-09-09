// Los íconos de la app, generados a partir de la marca (ver _marca.tsx).
//
// Tres tamaños en un solo archivo, con generateImageMetadata, más el
// maskable de Android. La convención es la de Next 16
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// 01-metadata/app-icons.md y .../04-functions/generate-image-metadata.md):
// cada item del array lleva su `id`, su `size` y su `contentType`, y la
// función que dibuja recibe ese `id` —que en 16 es una PROMESA, hay que
// esperarla— para saber cuál le toca.
//
// Por eso este archivo no exporta `size` ni `contentType`: esos dos son la
// variante de un solo ícono, y acá los trae cada item.

import { ImageResponse } from "next/og";

import { MEDIDAS_MASKABLE, Marca, medidasPara } from "./_marca";

/**
 * Qué se genera y para qué sirve cada uno:
 *
 *   32   favicon de la pestaña y de la barra de favoritos. Va con las
 *        medidas chicas (ver MEDIDAS_CHICAS).
 *   192  el que pide el manifiesto para la pantalla de inicio.
 *   512  el grande del manifiesto (splash, listados de la tienda).
 *   512 maskable  el mismo, con la marca al 80 % y sin esquina redondeada,
 *        para que Android le aplique su propia máscara sin comerse nada.
 *
 * El id es lo que Next mete en la URL, así que se elige legible.
 */
const ICONOS = [
  { id: "32", lado: 32, maskable: false },
  { id: "192", lado: 192, maskable: false },
  { id: "512", lado: 512, maskable: false },
  { id: "512-maskable", lado: 512, maskable: true },
] as const;

export function generateImageMetadata() {
  return ICONOS.map(({ id, lado }) => ({
    id,
    size: { width: lado, height: lado },
    contentType: "image/png",
    alt: "Sesión",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  // En Next 16 el id llega como promesa; sin el await se compara contra un
  // objeto y no coincide con ninguno.
  const cual = String(await id);
  const icono = ICONOS.find((i) => i.id === cual) ?? ICONOS[0];
  const medidas = icono.maskable ? MEDIDAS_MASKABLE : medidasPara(icono.lado);

  return new ImageResponse(<Marca lado={icono.lado} medidas={medidas} />, {
    width: icono.lado,
    height: icono.lado,
  });
}
