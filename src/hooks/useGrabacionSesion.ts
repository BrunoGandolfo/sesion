"use client";

// La sesión clínica del turno, leída una vez y seguida por polling mientras
// se procesa. La subida del audio no vive acá: es src/lib/subida-audio.ts.

import * as React from "react";

import {
  ESTADOS_ACTIVOS,
  normalizarSesionClinica,
  useSesionClinicaPolling,
  type SesionClinicaApiBase,
  type SesionClinicaEnsamblada,
} from "@/hooks/useSesionClinicaPolling";
import { apiGet } from "@/lib/api-client";
import type { Turno } from "@/types/domain";

interface UseGrabacionSesionOptions {
  turno: Turno | null;
}

interface UseGrabacionSesionResult {
  sesionClinica: SesionClinicaEnsamblada | null;
  loading: boolean;
}

// Sesión atada al turno que la cargó: si cambia el turno, la sesión anterior
// deja de ser visible (y `loading` vuelve a true) sin resetear estado dentro
// de un efecto.
type CargaSesion = {
  turnoId: string;
  sesion: SesionClinicaEnsamblada | null;
};

export function useGrabacionSesion({
  turno,
}: UseGrabacionSesionOptions): UseGrabacionSesionResult {
  const [carga, setCarga] = React.useState<CargaSesion | null>(null);
  const turnoId = turno?.id ?? null;

  const sesionClinica =
    carga && carga.turnoId === turnoId ? carga.sesion : null;
  const loading =
    turnoId !== null && (carga === null || carga.turnoId !== turnoId);

  const guardarSesion = React.useCallback(
    (sesion: SesionClinicaEnsamblada | null) => {
      if (!turnoId) return;
      setCarga({ turnoId, sesion });
    },
    [turnoId],
  );

  React.useEffect(() => {
    if (!turnoId) return;
    let cancelado = false;
    (async () => {
      let sesion: SesionClinicaEnsamblada | null = null;
      try {
        const fila = await apiGet<SesionClinicaApiBase | null>(
          `/api/sesion-clinica?turnoId=${turnoId}`,
        );
        sesion = fila ? normalizarSesionClinica(fila) : null;
      } catch {
        sesion = null;
      }
      if (cancelado) return;
      setCarga({ turnoId, sesion });
    })();
    return () => {
      cancelado = true;
    };
  }, [turnoId]);

  const enProcesamiento =
    sesionClinica !== null && ESTADOS_ACTIVOS.has(sesionClinica.estado);

  useSesionClinicaPolling({
    sesionClinicaId: enProcesamiento ? (sesionClinica?.id ?? null) : null,
    enabled: enProcesamiento,
    onSesion: ({ sesion }) => guardarSesion(sesion),
  });

  return { sesionClinica, loading };
}
