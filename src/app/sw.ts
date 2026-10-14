/// <reference lib="webworker" />

// El service worker de Sesión. Lo compila Serwist con esbuild en el build y
// lo sirve src/app/serwist/[path]/route.ts como /serwist/sw.js (el ejemplo
// oficial de Serwist para Next con Turbopack, `next-turbo-basic`).
//
// Para qué existe: que la app instalada se abra en modo avión. Sin esto,
// Android muestra "No tienes conexión" y no hay forma de llegar al grabador.
//
// LA REGLA está escrita y explicada en src/lib/sw-politica.ts:
//   - se precargan sólo los estáticos de la app y la pantalla /sin-conexion;
//   - las navegaciones van SIEMPRE a la red (NetworkOnly: nada se copia) y,
//     si la red falla, se sirve /sin-conexion;
//   - NUNCA se guarda /api/** ni el HTML de ninguna otra ruta. No hay
//     `runtimeCaching` que guarde nada, y tampoco el `defaultCache` del
//     ejemplo: ése sí guardaba respuestas de la API y páginas.
// src/lib/__tests__/sw-politica.test.ts carga este archivo y lo comprueba.

import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

import { ACTUALIZACION, esNavegacion, precargaPermitida, RUTA_SIN_CONEXION } from "@/lib/sw-politica";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: precargaPermitida(self.__SW_MANIFEST),
  // Al activarse una versión nueva se borra lo que la vieja precargó.
  precacheOptions: { cleanupOutdatedCaches: true },
  ...ACTUALIZACION,
  navigationPreload: true,
  runtimeCaching: [{ matcher: esNavegacion, handler: new NetworkOnly() }],
  fallbacks: {
    entries: [{ url: RUTA_SIN_CONEXION, matcher: esNavegacion }],
  },
});

serwist.addEventListeners();
