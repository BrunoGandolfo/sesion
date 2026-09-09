// El manifiesto de la PWA.
//
// Los íconos son los que genera icon.tsx: las URL salen de los `id` que
// declara su generateImageMetadata, con la forma /icon/<id>. Están escritas
// a mano acá porque Next no las expone como constante; si allá cambia un id,
// cambia acá (el build las lista, y son las que verifica el reporte).

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sesión",
    short_name: "Sesión",
    description: "Tu consulta, organizada.",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF6",
    // El mismo que declara viewport.themeColor en layout.tsx: si se separan,
    // la barra del navegador y la de la app instalada quedan de dos colores.
    theme_color: "#4F7A6A",
    icons: [
      {
        src: "/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Aparte, y con su propio dibujo: Android recorta hasta un 20 % de
      // cada borde para aplicar la máscara del sistema, así que esta versión
      // lleva la marca al 80 % y sin esquina redondeada. Servir la misma
      // imagen para "any" y "maskable" —lo que hacía el manifiesto viejo— se
      // ve recortado en el teléfono.
      {
        src: "/icon/512-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
