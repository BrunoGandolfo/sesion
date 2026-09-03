"use client";

import * as React from "react";

import {
  parseDatosEstructurados,
  type EstadoSesion,
  type SesionClinicaResponse as SesionClinicaApi,
} from "@/lib/sesion-clinica/schema";
import { ensamblarNotaSOAP } from "@/lib/sesion-clinica-utils";
import type {
  DatosEstructurados,
  SesionClinicaResponse,
} from "@/types/domain";

// ────────────────────────────────────────────────────────────────────────────
// Contrato de sesión clínica hacia la UI. Este hook es el nivel más bajo que
// lo consume: historia-tab y useGrabacionSesion importan de acá los estados
// activos, la forma de la fila y la normalización, sin repetirlos.
// ────────────────────────────────────────────────────────────────────────────

/** Estados en los que la sesión sigue en el pipeline (grabación → subida →
 *  worker) y conviene seguir consultando. Única definición, tipada por el
 *  enum del contrato (src/lib/sesion-clinica/schema.ts). */
export const ESTADOS_ACTIVOS: ReadonlySet<EstadoSesion> = new Set<EstadoSesion>([
  "grabando",
  "subiendo",
  "procesando",
]);

/** Campos del contrato que devuelven TODOS los endpoints que entregan una
 *  sesión a la UI (GET ?turnoId, GET/PATCH [id], POST, upload-confirmar).
 *  GET [id] devuelve el contrato completo (SesionClinicaApi). */
export type SesionClinicaApiBase = Pick<
  SesionClinicaApi,
  | "id"
  | "turnoId"
  | "estado"
  | "duracionAudioSeg"
  | "audioR2Key"
  | "createdAt"
  | "notaSubjetivo"
  | "notaObjetivo"
  | "notaAnalisis"
  | "notaPlan"
  | "datosEstructurados"
  | "modeloASR"
  | "modeloLLM"
  | "procesadoEn"
  | "aprobadoEn"
  | "error"
  | "intentos"
>;

export type { SesionClinicaApi };

/**
 * Fila del contrato → forma que consume la UI (src/types/domain
 * SesionClinicaResponse, con `nota` ensamblada). La nota se arma con
 * ensamblarNotaSOAP y datosEstructurados se valida con el parser del
 * contrato (un shape inválido queda en null).
 */
export function normalizarSesionClinica(
  fila: SesionClinicaApiBase,
): SesionClinicaResponse {
  // parseDatosEstructurados devuelve el tipo del contrato, con todas las
  // propiedades opcionales. Los consumidores (NotaClinicaView,
  // FeedbackTerapeutaView, paciente-detail-view) siguen tipados con
  // DatosEstructurados de src/types/domain, que es un subtipo del contrato
  // (todas sus propiedades existen ahí). Hasta que migren al contrato, el
  // estrechamiento se hace acá, una sola vez y sobre datos ya validados.
  const datos = parseDatosEstructurados(fila.datosEstructurados);
  return {
    id: fila.id,
    turnoId: fila.turnoId,
    estado: fila.estado,
    duracionAudioSeg: fila.duracionAudioSeg,
    nota: ensamblarNotaSOAP({
      subjetivo: fila.notaSubjetivo,
      objetivo: fila.notaObjetivo,
      analisis: fila.notaAnalisis,
      plan: fila.notaPlan,
    }),
    datosEstructurados: datos as DatosEstructurados | null,
    modeloASR: fila.modeloASR,
    modeloLLM: fila.modeloLLM,
    procesadoEn: fila.procesadoEn,
    aprobadoEn: fila.aprobadoEn,
    error: fila.error,
  };
}

interface UseSesionClinicaPollingOptions {
  sesionClinicaId: string | null;
  intervaloMs?: number;
  enabled?: boolean;
  /** Se invoca con cada respuesta OK: la fila del contrato y su versión
   *  normalizada. Permite al caller actualizar su propio estado sin un
   *  useEffect sobre `data`. */
  onSesion?: (resultado: ResultadoPolling) => void;
}

export interface ResultadoPolling {
  fila: SesionClinicaApi;
  sesion: SesionClinicaResponse;
}

interface UseSesionClinicaPollingResult {
  data: SesionClinicaResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Resultado atado al id que lo produjo: si cambia sesionClinicaId (o se
// deshabilita el polling) el resultado viejo deja de ser visible sin
// resetear estado dentro de un efecto.
type EstadoPolling = {
  sesionClinicaId: string;
  data: SesionClinicaResponse | null;
  loading: boolean;
  error: string | null;
};

export function useSesionClinicaPolling(
  options: UseSesionClinicaPollingOptions,
): UseSesionClinicaPollingResult {
  const {
    sesionClinicaId,
    intervaloMs = 10000,
    enabled = true,
    onSesion,
  } = options;

  const [estado, setEstado] = React.useState<EstadoPolling | null>(null);

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const estadoRef = React.useRef<EstadoSesion | null>(null);
  const onSesionRef = React.useRef(onSesion);
  React.useEffect(() => {
    onSesionRef.current = onSesion;
  }, [onSesion]);

  const actualizarEstado = React.useCallback(
    (id: string, parcial: Partial<Omit<EstadoPolling, "sesionClinicaId">>) => {
      setEstado((prev) =>
        prev && prev.sesionClinicaId === id
          ? { ...prev, ...parcial }
          : {
              sesionClinicaId: id,
              data: null,
              loading: false,
              error: null,
              ...parcial,
            },
      );
    },
    [],
  );

  const clearTimer = React.useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fetchOnce = React.useCallback(async (): Promise<void> => {
    if (!sesionClinicaId || !enabled) return;
    const id = sesionClinicaId;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    actualizarEstado(id, { loading: true });

    try {
      const res = await fetch(`/api/sesion-clinica/${id}`, {
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // La API envuelve la sesión en { data: ... } (responses.ts → ok()).
      const body = (await res.json()) as { data: SesionClinicaApi | null };
      if (!body.data) {
        throw new Error("Sesión clínica no disponible");
      }
      const fila = body.data;
      const normalized = normalizarSesionClinica(fila);

      if (controller.signal.aborted) return;

      estadoRef.current = normalized.estado;
      actualizarEstado(id, { data: normalized, error: null });
      onSesionRef.current?.({ fila, sesion: normalized });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      actualizarEstado(id, {
        error: err instanceof Error ? err.message : "Error al cargar la sesión",
      });
    } finally {
      if (!controller.signal.aborted) {
        actualizarEstado(id, { loading: false });
      }
    }
  }, [sesionClinicaId, enabled, actualizarEstado]);

  React.useEffect(() => {
    estadoRef.current = null;
    if (!sesionClinicaId || !enabled) return;

    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      await fetchOnce();
      if (cancelled) return;

      const estadoActual = estadoRef.current;
      if (estadoActual !== null && ESTADOS_ACTIVOS.has(estadoActual)) {
        clearTimer();
        timeoutRef.current = setTimeout(() => {
          void tick();
        }, intervaloMs);
      }
    };

    void tick();

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const estadoActual = estadoRef.current;
        if (estadoActual === null || ESTADOS_ACTIVOS.has(estadoActual)) {
          void tick();
        }
      } else {
        clearTimer();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      abortRef.current?.abort();
    };
  }, [sesionClinicaId, enabled, intervaloMs, fetchOnce, clearTimer]);

  if (!sesionClinicaId || !enabled) {
    return { data: null, loading: false, error: null, refetch: fetchOnce };
  }

  const actual =
    estado && estado.sesionClinicaId === sesionClinicaId ? estado : null;

  return {
    data: actual?.data ?? null,
    loading: actual?.loading ?? false,
    error: actual?.error ?? null,
    refetch: fetchOnce,
  };
}
