"use client";

// Cerrar sesión desde el navegador: le pide al servidor que cierre ESTA
// sesión (y borre la cookie) y recién después navega. Es lo único que un
// componente cliente necesita saber de la sesión; leer quién está entrada
// se hace por el contexto de src/components/layout/providers.tsx.

import { olvidarNotas } from "@/lib/notas-en-proceso";

export async function cerrarSesion(destino = "/login"): Promise<void> {
  // El aviso de nota lista guarda el nombre de la paciente en la pestaña.
  olvidarNotas();
  try {
    await fetch("/api/cuenta/salir", { method: "POST", credentials: "same-origin" });
  } catch {
    // Sin red la cookie queda; el servidor la va a rechazar igual cuando venza.
  }
  window.location.assign(destino);
}
