// El ícono de la pantalla de inicio de iOS: uno solo, 180 px.
//
// Acá no va generateImageMetadata —iOS quiere un único apple-touch-icon—,
// así que se usa la variante de un solo ícono: `size` y `contentType`
// exportados y la función devolviendo la imagen.
//
// Dos particularidades de Apple frente al favicon:
//
//   - la esquina redondeada la pone iOS con su propia máscara, pero un radio
//     nuestro más chico que el suyo no se nota y sí evita que el ícono se vea
//     cuadrado en los lugares donde iOS lo muestra sin enmascarar (ajustes,
//     resultados de búsqueda). Se conserva el de la marca;
//   - sin transparencia: el fondo salvia llega hasta el borde.

import { ImageResponse } from "next/og";

import { Marca, medidasPara } from "./_marca";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <Marca lado={size.width} medidas={medidasPara(size.width)} />,
    { ...size },
  );
}
