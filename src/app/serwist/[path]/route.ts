// Sirve el service worker (/serwist/sw.js y su mapa). Es el ejemplo oficial
// de Serwist para Next con Turbopack: la ruta es estática (force-static,
// generateStaticParams), así que `next build` compila src/app/sw.ts con
// esbuild y deja el archivo prerenderizado en .next/. No hay public/sw.js.
//
// Serwist responde con `Service-Worker-Allowed: /`, que es lo que deja
// registrarlo con alcance "/" aunque viva en /serwist/.
//
// Fuera del proxy: el matcher de src/proxy.ts excluye `.js` y `.map`.

import { createSerwistRoute } from "@serwist/turbopack";

import { PATRONES_PRECARGA, RUTA_SIN_CONEXION } from "@/lib/sw-politica";
import { VERSION_APP } from "@/lib/version-app";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  // La pantalla sin conexión cambia con cada build (sus scripts tienen
  // hash): se vuelve a bajar con cada versión. VERSION_APP es el
  // identificador del build (next.config.ts).
  additionalPrecacheEntries: [{ url: RUTA_SIN_CONEXION, revision: VERSION_APP }],
  globPatterns: PATRONES_PRECARGA,
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
