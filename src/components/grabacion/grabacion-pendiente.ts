"use client";

// Una grabación de esta pantalla (de este turno, o sin turno de esta
// paciente) que quedó en el teléfono (el navegador mató la página, o no hubo
// señal para subirla). No se puede continuar —haría falta otro recorder—: se ofrece
// enviarla o descartarla. Sólo se ofrece con el grabador quieto.

import * as React from "react";

import { limpiarGrabacion, recuperarGrabacionPendiente, type GrabacionPendiente } from "@/lib/grabacion-storage";

import type { EstadoGrabador, PendienteGuardada } from "./grabador-tipos";

export function useGrabacionPendiente(
  claveGrabacion: string | null,
  /** Qué grabaciones guardadas son de esta pantalla. Sin esto, la de
   *  `claveGrabacion` (y ninguna si tampoco hay clave). */
  esPendiente: ((clave: string, turnoId: string | null, pacienteId: string | null) => boolean) | undefined,
  estadoRef: React.RefObject<EstadoGrabador>,
  /** La clave de la grabación en curso: la que se borra si no hay guardada. */
  claveRef: React.RefObject<string | null>,
) {
  const [pendiente, setPendiente] = React.useState<GrabacionPendiente | null>(null);
  // Sube después de borrar una: la búsqueda vuelve a correr y ofrece la
  // siguiente que coincida, si hay más de una guardada.
  const [busqueda, setBusqueda] = React.useState(0);
  const coincide = React.useMemo(
    () => esPendiente ?? (claveGrabacion ? (clave: string) => clave === claveGrabacion : null),
    [esPendiente, claveGrabacion],
  );

  React.useEffect(() => {
    if (!coincide) return;
    let cancelado = false;
    void recuperarGrabacionPendiente(coincide).then((recuperada) => {
      if (cancelado || !recuperada || !coincide(recuperada.sesionClinicaId, recuperada.turnoId, recuperada.pacienteId)) return;
      if (estadoRef.current !== "inactivo") return;
      setPendiente(recuperada);
    });
    return () => {
      cancelado = true;
    };
  }, [coincide, estadoRef, busqueda]);

  /** Descartarla: se borra con SU clave, que puede no ser la del prop (una
   *  grabación sin turno se encuentra por paciente). */
  function descartar() {
    const clave = pendiente?.sesionClinicaId ?? claveRef.current;
    setPendiente(null);
    if (clave) void limpiarGrabacion(clave).then(() => setBusqueda((n) => n + 1));
  }

  const guardada: PendienteGuardada | null =
    pendiente && { clave: pendiente.sesionClinicaId, iniciadaEn: pendiente.iniciadaEn, turnoId: pendiente.turnoId };

  return { pendiente, setPendiente, guardada, descartar };
}
