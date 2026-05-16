"use client";

import * as React from "react";

import { useSesionClinicaPolling } from "@/hooks/useSesionClinicaPolling";
import type {
  DatosEstructurados,
  EstadoProcesamiento,
  NotaSOAP,
  SesionClinicaResponse,
  Turno,
} from "@/types/domain";

interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
}

interface UseGrabacionSesionOptions {
  turno: Turno | null;
  onTurnoActualizado?: () => void;
}

interface UseGrabacionSesionResult {
  sesionClinica: SesionClinicaResponse | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  iniciar: () => Promise<void>;
  completar: (datos: DatosGrabacion) => Promise<void>;
  reintentar: () => Promise<void>;
  refrescar: () => Promise<void>;
}

type RawSesionClinica = {
  id: string;
  turnoId: string;
  estado: string;
  duracionAudioSeg: number | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  datosEstructurados: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
};

function parseDatosEstructurados(
  value: DatosEstructurados | string | null,
): DatosEstructurados | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DatosEstructurados;
    } catch {
      return null;
    }
  }
  return value;
}

function toSesionClinicaResponse(raw: RawSesionClinica): SesionClinicaResponse {
  const nota: NotaSOAP | null =
    raw.notaSubjetivo !== null &&
    raw.notaObjetivo !== null &&
    raw.notaAnalisis !== null &&
    raw.notaPlan !== null
      ? {
          subjetivo: raw.notaSubjetivo,
          objetivo: raw.notaObjetivo,
          analisis: raw.notaAnalisis,
          plan: raw.notaPlan,
        }
      : null;

  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado as EstadoProcesamiento,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota,
    datosEstructurados: parseDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
  };
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `HTTP ${res.status}`;
}

export function useGrabacionSesion({
  turno,
  onTurnoActualizado,
}: UseGrabacionSesionOptions): UseGrabacionSesionResult {
  const [sesionClinica, setSesionClinica] =
    React.useState<SesionClinicaResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(Boolean(turno));
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const turnoId = turno?.id ?? null;
  const turnoEstado = turno?.estado ?? null;
  const onTurnoActualizadoRef = React.useRef(onTurnoActualizado);
  React.useEffect(() => {
    onTurnoActualizadoRef.current = onTurnoActualizado;
  }, [onTurnoActualizado]);

  React.useEffect(() => {
    if (!turnoId) {
      setSesionClinica(null);
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/sesion-clinica?turnoId=${turnoId}`, {
          cache: "no-store",
        });
        if (cancelado) return;
        if (res.ok) {
          const body = (await res.json()) as { data: RawSesionClinica | null };
          setSesionClinica(
            body.data ? toSesionClinicaResponse(body.data) : null,
          );
        } else {
          setSesionClinica(null);
        }
      } catch {
        if (!cancelado) setSesionClinica(null);
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [turnoId]);

  const enProcesamiento =
    sesionClinica !== null &&
    (sesionClinica.estado === "grabando" ||
      sesionClinica.estado === "subiendo" ||
      sesionClinica.estado === "procesando");

  const { data: polled } = useSesionClinicaPolling({
    sesionClinicaId: enProcesamiento ? (sesionClinica?.id ?? null) : null,
    enabled: enProcesamiento,
  });

  React.useEffect(() => {
    if (polled) setSesionClinica(polled);
  }, [polled]);

  const iniciar = React.useCallback(async () => {
    if (!turnoId) return;
    setError(null);
    setSubmitting(true);
    try {
      const createRes = await fetch("/api/sesion-clinica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId }),
      });
      if (!createRes.ok) throw new Error(await parseError(createRes));
      const createBody = (await createRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(createBody.data));

      const patchRes = await fetch(
        `/api/sesion-clinica/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "grabando" }),
        },
      );
      if (!patchRes.ok) throw new Error(await parseError(patchRes));
      const patchBody = (await patchRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(patchBody.data));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar la grabación",
      );
    } finally {
      setSubmitting(false);
    }
  }, [turnoId]);

  const completar = React.useCallback(
    async (datos: DatosGrabacion) => {
      const current = sesionClinica;
      if (!current || !turnoId) return;
      const sesionId = current.id;
      const eraProgramado = turnoEstado === "programado";
      setError(null);
      setSubmitting(true);
      try {
        const formData = new FormData();
        formData.append("audio", datos.audioBlob, "sesion.bin");
        formData.append("claveCifrado", datos.claveCifrado);
        formData.append("iv", datos.ivCifrado);
        formData.append("duracionSegundos", String(datos.duracionSegundos));

        const uploadRes = await fetch(
          `/api/sesion-clinica/${sesionId}/upload`,
          { method: "POST", body: formData },
        );
        if (!uploadRes.ok) throw new Error(await parseError(uploadRes));

        if (eraProgramado) {
          try {
            await fetch(`/api/turnos/${turnoId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ estado: "realizado" }),
            });
          } catch {
            // best-effort
          }
          onTurnoActualizadoRef.current?.();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al subir el audio",
        );
        try {
          await fetch(`/api/sesion-clinica/${sesionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: "error" }),
          });
        } catch {
          // tragar
        }
      } finally {
        setSubmitting(false);
      }
    },
    [sesionClinica, turnoId, turnoEstado],
  );

  const reintentar = React.useCallback(async () => {
    if (!sesionClinica) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "procesando" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(body.data));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo reintentar",
      );
    } finally {
      setSubmitting(false);
    }
  }, [sesionClinica]);

  const refrescar = React.useCallback(async () => {
    if (!sesionClinica) return;
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(body.data));
      onTurnoActualizadoRef.current?.();
    } catch {
      // tragar
    }
  }, [sesionClinica]);

  return {
    sesionClinica,
    loading,
    submitting,
    error,
    iniciar,
    completar,
    reintentar,
    refrescar,
  };
}
