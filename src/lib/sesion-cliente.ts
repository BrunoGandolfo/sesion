"use client";

// Cerrar sesión desde el navegador: le pide al servidor que cierre ESTA
// sesión (y borre la cookie) y recién después navega. Es lo único que un
// componente cliente necesita saber de la sesión; leer quién está entrada
// se hace por el contexto de src/components/layout/providers.tsx.

import { abrirAgendaLocal, olvidarAgendaLocal } from "@/lib/agenda-local";
import { olvidarNotas } from "@/lib/notas-en-proceso";

/** Se llama `salir` y no `cerrarSesion`: ese nombre es el del servidor
 *  (sesion-acceso.ts, con Prisma), y un auto-import equivocado en un
 *  componente cliente arrastraba la base al bundle. */
export async function salir(destino = "/login"): Promise<void> {
  // El aviso de nota lista guarda el nombre de la paciente en la pestaña.
  olvidarNotas();
  // La agenda guardada para grabar sin señal tiene nombres de pacientes: se
  // borra y queda cerrada a escrituras que lleguen tarde (agenda-local.ts).
  await olvidarAgendaLocal();
  let cerrada = false;
  try {
    const respuesta = await fetch("/api/cuenta/salir", { method: "POST", credentials: "same-origin" });
    cerrada = respuesta.ok;
  } catch {
    // Sin red la cookie queda; el servidor la va a rechazar igual cuando venza.
  }
  // Si el servidor no cerró la sesión, sigue viva: la agenda (ya vacía) se
  // vuelve a llenar desde Hoy como siempre, en vez de quedar apagada.
  if (!cerrada) await abrirAgendaLocal();
  window.location.assign(destino);
}

