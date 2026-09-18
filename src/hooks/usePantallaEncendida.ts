"use client";

// Mantener la pantalla encendida (Screen Wake Lock) mientras la pantalla de
// grabar está abierta: antes de grabar, grabando y también mientras sube.
//
// El teléfono puede negarlo (ahorro de batería, navegador sin soporte) y puede
// soltarlo cuando quiere (la pantalla se bloqueó igual). Las dos cosas se le
// dicen a la profesional: la primera ANTES de empezar, la segunda con un aviso
// que queda hasta que ella lo cierra. Y las dos se anotan en el diagnóstico.

import * as React from "react";

export type EstadoPantalla = "pidiendo" | "concedida" | "rechazada";
type Anotar = (tipo: "wakelock-concedido" | "wakelock-rechazado" | "wakelock-soltado") => void;

export function usePantallaEncendida(activa: boolean, avisarSiSeApaga: boolean, anotar: Anotar) {
  const [estado, setEstado] = React.useState<EstadoPantalla>("pidiendo");
  const [seApago, setSeApago] = React.useState(false);
  const avisarRef = React.useRef(avisarSiSeApaga);
  const anotarRef = React.useRef(anotar);

  React.useEffect(() => {
    avisarRef.current = avisarSiSeApaga;
    anotarRef.current = anotar;
  }, [avisarSiSeApaga, anotar]);

  React.useEffect(() => {
    if (!activa) return;
    let cancelado = false;
    let lock: WakeLockSentinel | null = null;

    const pedir = async () => {
      if (cancelado || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      if (!navigator.wakeLock) {
        setEstado("rechazada");
        anotarRef.current("wakelock-rechazado");
        return;
      }
      try {
        const nuevo = await navigator.wakeLock.request("screen");
        if (cancelado) {
          void nuevo.release().catch(() => {});
          return;
        }
        lock = nuevo;
        setEstado("concedida");
        anotarRef.current("wakelock-concedido");
        nuevo.addEventListener("release", () => {
          if (cancelado) return;
          lock = null;
          anotarRef.current("wakelock-soltado");
          if (avisarRef.current) setSeApago(true);
        });
      } catch {
        setEstado("rechazada");
        anotarRef.current("wakelock-rechazado");
      }
    };

    void pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", pedir);
      void lock?.release().catch(() => {});
    };
  }, [activa]);

  return { estado, seApago, cerrarAviso: () => setSeApago(false) };
}
