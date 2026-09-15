"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { VERSION_APP } from "@/lib/version-app";

export function esRutaGrabacion(ruta: string) {
  return ruta === "/grabar" || ruta.startsWith("/grabar/");
}

const recargarPagina = () => window.location.reload();

/** Sólo propone actualizar. Nunca recarga por una respuesta o un temporizador. */
export function AvisoVersion({ recargar = recargarPagina }: { recargar?: () => void }) {
  const ruta = usePathname();
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  const grabando = esRutaGrabacion(ruta);

  useEffect(() => {
    if (grabando) return;
    let vigente = true;
    let pedido: AbortController | undefined;
    let limite: ReturnType<typeof setTimeout> | undefined;

    async function comprobar() {
      if (document.visibilityState !== "visible" || pedido) return;
      const controlador = new AbortController();
      pedido = controlador;
      limite = setTimeout(() => controlador.abort(), 10_000);
      try {
        const respuesta = await fetch("/api/version", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controlador.signal,
        });
        if (!respuesta.ok) return;
        const cuerpo = await respuesta.json();
        const version = cuerpo?.data?.version;
        if (vigente && !controlador.signal.aborted && typeof version === "string" && version.length > 0) {
          setHayVersionNueva(version !== VERSION_APP);
        }
      } catch {
        // Sin conexión o chequeo fallido: conservar la pantalla y probar al volver.
      } finally {
        clearTimeout(limite);
        pedido = undefined;
      }
    }

    void comprobar();
    document.addEventListener("visibilitychange", comprobar);
    window.addEventListener("focus", comprobar);
    window.addEventListener("pageshow", comprobar);
    return () => {
      vigente = false;
      clearTimeout(limite);
      pedido?.abort();
      document.removeEventListener("visibilitychange", comprobar);
      window.removeEventListener("focus", comprobar);
      window.removeEventListener("pageshow", comprobar);
    };
  }, [grabando]);

  if (!hayVersionNueva || grabando) return null;

  return (
    <div role="status" className="border-b border-sage-200 bg-sage-50 px-4 py-2 text-center">
      <button
        type="button"
        className="min-h-11 text-sm font-medium text-ink-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
        onClick={() => {
          // Comprobar también el destino real si el toque coincidió con una navegación.
          if (!esRutaGrabacion(ruta) && !esRutaGrabacion(window.location.pathname)) recargar();
        }}
      >
        Hay una versión nueva. Tocá para actualizar
      </button>
    </div>
  );
}
