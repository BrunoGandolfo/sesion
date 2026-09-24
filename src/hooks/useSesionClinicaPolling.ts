"use client";

import * as React from "react";

import { ESTADOS_EN_PIPELINE } from "@/lib/sesion-clinica/estados";
import {
  parseDatosEstructurados,
  type DatosEstructurados,
  type EstadoSesion,
  type NotaSoap,
  type SesionClinicaResponse as SesionClinicaApi,
} from "@/lib/sesion-clinica/schema";

// ────────────────────────────────────────────────────────────────────────────
// Contrato de sesión clínica hacia la UI. Este hook es el nivel más bajo que
// lo consume: sesiones-tab y useGrabacionSesion importan de acá los estados
// activos, la forma de la fila y la normalización, sin repetirlos.
// ────────────────────────────────────────────────────────────────────────────

/** Estados en los que la sesión sigue en el pipeline (grabación → subida →
 *  worker) y conviene seguir consultando. No se escriben acá: salen de la
 *  tabla de operaciones (ESTADOS_EN_PIPELINE, en sesion-clinica/estados.ts). */
export const ESTADOS_ACTIVOS: ReadonlySet<EstadoSesion> = ESTADOS_EN_PIPELINE;

/** Campos del contrato que devuelven TODOS los endpoints que entregan una
 *  sesión a la UI (GET ?turnoId, GET [id], POST).
 *  GET [id] devuelve el contrato completo (SesionClinicaApi). */
export type SesionClinicaApiBase = Pick<
  SesionClinicaApi,
  | "id"
  | "turnoId"
  | "estado"
  | "audioEstado"
  | "duracionAudioSeg"
  | "intento"
  | "generacion"
  | "falloCodigo"
  | "falloDetalle"
  | "notaIa"
  | "notaFinal"
  | "datos"
  | "feedback"
  | "feedbackEstado"
  | "modeloAsr"
  | "modeloLlm"
  | "procesadaEn"
  | "aprobadaEn"
  | "creadaEn"
>;

export type { SesionClinicaApi };

/**
 * La sesión como la consumen las pantallas: la nota vigente (la aprobada si
 * existe, si no la de la IA), el tablero ya validado y el fallo en palabras.
 * Antes vivía en src/lib/sesion-clinica-utils.ts (borrado).
 */
export interface SesionClinicaEnsamblada {
  id: string;
  turnoId: string;
  estado: EstadoSesion;
  duracionAudioSeg: number | null;
  nota: NotaSoap | null;
  datosEstructurados: DatosEstructurados | null;
  /** El reporte "Para vos"; su forma la valida quien lo dibuja (hayParaVos). */
  feedback: unknown;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
}

/**
 * Fila del contrato → forma que consume la UI. `nota` es notaFinal si ya se
 * aprobó, si no notaIa; `datos` se valida con el parser del contrato (un
 * shape inválido queda en null); `error` es el detalle del fallo.
 */
export function normalizarSesionClinica(
  fila: SesionClinicaApiBase,
): SesionClinicaEnsamblada {
  return {
    id: fila.id,
    turnoId: fila.turnoId,
    estado: fila.estado,
    duracionAudioSeg: fila.duracionAudioSeg,
    nota: fila.notaFinal ?? fila.notaIa,
    datosEstructurados: parseDatosEstructurados(fila.datos),
    feedback: fila.feedback,
    modeloASR: fila.modeloAsr,
    modeloLLM: fila.modeloLlm,
    procesadoEn: fila.procesadaEn,
    aprobadoEn: fila.aprobadaEn,
    error: fila.falloDetalle,
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
  sesion: SesionClinicaEnsamblada;
}

interface UseSesionClinicaPollingResult {
  data: SesionClinicaEnsamblada | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Resultado atado al id que lo produjo: si cambia sesionClinicaId (o se
// deshabilita el polling) el resultado viejo deja de ser visible sin
// resetear estado dentro de un efecto.
type EstadoPolling = {
  sesionClinicaId: string;
  data: SesionClinicaEnsamblada | null;
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
