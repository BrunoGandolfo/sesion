"use client";

// "Para vos" mientras se escribe: con la vista abierta y el análisis
// pendiente, la fila se relee cada 10 s hasta que deja de estarlo. Y el
// pedido de volver a escribirlo, que puede crear el trabajo aunque se pierda
// su respuesta.

import * as React from "react";

import { apiPost, esAbort, mensajeParaElla } from "@/lib/api-client";
import { FEEDBACK_REINTENTAR_ERROR } from "@/lib/glosario";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { leerSesion } from "./datos";
import type { VistaSesion } from "./selector-vista";

const ESPERA_RELECTURA_MS = 10_000;

export function useParaVos({
  id,
  vista,
  feedbackEstado,
  aplicar,
}: {
  id: string;
  vista: VistaSesion;
  feedbackEstado: SesionClinicaResponse["feedbackEstado"] | undefined;
  aplicar: (fila: SesionClinicaResponse) => void;
}) {
  const [pidiendo, setPidiendo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lectura, setLectura] = React.useState(0);

  React.useEffect(() => {
    if (vista !== "para-vos" || feedbackEstado !== "pendiente") return;
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const leer = async () => {
      try {
        const fila = await leerSesion(id, control.signal);
        if (control.signal.aborted) return;
        aplicar(fila); setError(null);
        if (fila.feedbackEstado === "pendiente") timer = setTimeout(leer, ESPERA_RELECTURA_MS);
      } catch (e) {
        if (!esAbort(e)) setError(mensajeParaElla(e));
      }
    };
    timer = setTimeout(leer, lectura ? 0 : ESPERA_RELECTURA_MS);
    return () => { control.abort(); clearTimeout(timer); };
  }, [id, vista, feedbackEstado, lectura, aplicar]);

  const pedir = async () => {
    if (pidiendo) return;
    setPidiendo(true); setError(null);
    try {
      const fila = await apiPost<SesionClinicaResponse>(`/api/sesion-clinica/${id}/feedback/reintentar`, {});
      aplicar(fila);
    } catch {
      // Puede haberse creado el trabajo aunque se haya perdido su respuesta.
      try {
        const fila = await leerSesion(id);
        aplicar(fila);
        if (fila.feedbackEstado === "pendiente" || fila.feedbackEstado === "listo") return;
      }
      catch { /* El mensaje no afirma que el pedido haya fallado. */ }
      setError(FEEDBACK_REINTENTAR_ERROR);
    } finally { setPidiendo(false); }
  };

  return {
    pidiendo,
    error,
    pedir,
    /** Relee la fila ya, sin esperar los 10 s. */
    actualizar: () => setLectura((n) => n + 1),
  };
}
