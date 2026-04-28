"use client";

import * as React from "react";

import type {
  DatosEstructurados,
  EstadoProcesamiento,
  NotaSOAP,
  SesionClinicaResponse,
} from "@/types/domain";

interface UseSesionClinicaPollingOptions {
  sesionClinicaId: string | null;
  intervaloMs?: number;
  enabled?: boolean;
}

interface UseSesionClinicaPollingResult {
  data: SesionClinicaResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ESTADOS_ACTIVOS: ReadonlySet<EstadoProcesamiento> = new Set<EstadoProcesamiento>([
  "grabando",
  "subiendo",
  "procesando",
]);

interface RawSesionClinicaResponse {
  id: string;
  turnoId: string;
  estado: EstadoProcesamiento;
  duracionAudioSeg: number | null;
  nota?: NotaSOAP | null;
  notaSubjetivo?: string | null;
  notaObjetivo?: string | null;
  notaAnalisis?: string | null;
  notaPlan?: string | null;
  datosEstructurados?: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
}

function parseDatosEstructurados(
  value: DatosEstructurados | string | null | undefined,
): DatosEstructurados | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as DatosEstructurados;
  } catch {
    return null;
  }
}

function ensamblarNota(raw: RawSesionClinicaResponse): NotaSOAP | null {
  if (raw.nota) return raw.nota;
  const { notaSubjetivo, notaObjetivo, notaAnalisis, notaPlan } = raw;
  if (
    notaSubjetivo == null &&
    notaObjetivo == null &&
    notaAnalisis == null &&
    notaPlan == null
  ) {
    return null;
  }
  return {
    subjetivo: notaSubjetivo ?? "",
    objetivo: notaObjetivo ?? "",
    analisis: notaAnalisis ?? "",
    plan: notaPlan ?? "",
  };
}

function normalize(raw: RawSesionClinicaResponse): SesionClinicaResponse {
  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota: ensamblarNota(raw),
    datosEstructurados: parseDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
  };
}

export function useSesionClinicaPolling(
  options: UseSesionClinicaPollingOptions,
): UseSesionClinicaPollingResult {
  const { sesionClinicaId, intervaloMs = 10000, enabled = true } = options;

  const [data, setData] = React.useState<SesionClinicaResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const estadoRef = React.useRef<EstadoProcesamiento | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fetchOnce = React.useCallback(async (): Promise<void> => {
    if (!sesionClinicaId || !enabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinicaId}`, {
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const raw = (await res.json()) as RawSesionClinicaResponse;
      const normalized = normalize(raw);

      if (controller.signal.aborted) return;

      estadoRef.current = normalized.estado;
      setData(normalized);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Error al cargar la sesión");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sesionClinicaId, enabled]);

  React.useEffect(() => {
    if (!sesionClinicaId || !enabled) {
      estadoRef.current = null;
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    estadoRef.current = null;
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

      const estado = estadoRef.current;
      if (estado !== null && ESTADOS_ACTIVOS.has(estado)) {
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
        const estado = estadoRef.current;
        if (estado === null || ESTADOS_ACTIVOS.has(estado)) {
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

  return { data, loading, error, refetch: fetchOnce };
}
