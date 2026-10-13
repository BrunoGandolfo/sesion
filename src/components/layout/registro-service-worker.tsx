"use client";

// Registra el service worker (src/app/sw.ts) con el proveedor de Serwist,
// como en su ejemplo oficial para Turbopack, con dos opciones del ejemplo
// APAGADAS a propósito:
//
//   - cacheOnNavigation: guardaría en el teléfono el HTML de cada página que
//     se visita (fichas, notas). La regla es que no se guarda ninguna
//     (src/lib/sw-politica.ts).
//   - reloadOnOnline: recargaría la página al volver la señal, y eso corta
//     una grabación en curso. Ninguna pantalla se recarga sola
//     (aviso-version.tsx).
//
// En desarrollo no se registra: `next dev` no es una referencia para el
// comportamiento sin conexión (lo dice la doc de Next) y un service worker
// ahí sólo confunde.

import { SerwistProvider } from "@serwist/turbopack/react";

import { URL_SW } from "@/lib/sw-politica";

export function RegistroServiceWorker({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider
      swUrl={URL_SW}
      cacheOnNavigation={false}
      reloadOnOnline={false}
      disable={process.env.NODE_ENV === "development"}
    >
      {children}
    </SerwistProvider>
  );
}
