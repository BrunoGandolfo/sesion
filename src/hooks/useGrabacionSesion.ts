"use client";
// Lectura de la sesión del turno para la ficha. Captura: useAudioGrabacion.
import { useCallback, useEffect, useState } from "react";
import { ESTADOS_ACTIVOS, normalizarSesionClinica, useSesionClinicaPolling, type SesionClinicaApiBase, type SesionClinicaEnsamblada } from "./useSesionClinicaPolling";
import type { Turno } from "@/types/domain";
export function useGrabacionSesion({ turno }: { turno: Turno | null; onTurnoActualizado?: () => void }) {
  const turnoId = turno?.id ?? null;
  const [carga, setCarga] = useState<{ turnoId: string; sesion: SesionClinicaEnsamblada | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!turnoId) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const r = await fetch(`/api/sesion-clinica?turnoId=${turnoId}`, { cache: "no-store", signal: abort.signal });
        if (!r.ok) throw new Error("No se pudo consultar la sesión");
        const { data } = await r.json() as { data: SesionClinicaApiBase | null };
        if (!abort.signal.aborted) { setCarga({ turnoId, sesion: data ? normalizarSesionClinica(data) : null }); setError(null); }
      } catch { if (!abort.signal.aborted) setError("No se pudo consultar la sesión"); }
    })();
    return () => abort.abort();
  }, [turnoId]);
  const sesionClinica = carga?.turnoId === turnoId ? carga?.sesion ?? null : null;
  const actualizar = useCallback(({ sesion }: { sesion: SesionClinicaEnsamblada }) => { if (turnoId) setCarga({ turnoId, sesion }); }, [turnoId]);
  useSesionClinicaPolling({ sesionClinicaId: sesionClinica?.id ?? null, enabled: !!sesionClinica && ESTADOS_ACTIVOS.has(sesionClinica.estado), onSesion: actualizar });
  return { sesionClinica, loading: !!turnoId && carga?.turnoId !== turnoId && !error, error };
}
