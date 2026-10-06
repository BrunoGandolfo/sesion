"use client";

// Una grabación de este turno que quedó en el teléfono (el navegador mató
// la página). No se puede continuar —haría falta otro recorder—: se ofrece
// enviarla o descartarla. Sólo se ofrece con el grabador quieto.

import * as React from "react";

import { recuperarGrabacionPendiente, type GrabacionPendiente } from "@/lib/grabacion-storage";

import type { EstadoGrabador } from "./grabador-tipos";

export function useGrabacionPendiente(
  claveGrabacion: string | null,
  estadoRef: React.RefObject<EstadoGrabador>,
) {
  const [pendiente, setPendiente] = React.useState<GrabacionPendiente | null>(null);

  React.useEffect(() => {
    if (!claveGrabacion) return;
    let cancelado = false;
    void recuperarGrabacionPendiente().then((recuperada) => {
      if (cancelado || !recuperada || recuperada.sesionClinicaId !== claveGrabacion) return;
      if (estadoRef.current !== "inactivo") return;
      setPendiente(recuperada);
    });
    return () => {
      cancelado = true;
    };
  }, [claveGrabacion, estadoRef]);

  return [pendiente, setPendiente] as const;
}
