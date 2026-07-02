"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import {
  esSesionHuerfana,
  UMBRAL_HUERFANA_HORAS,
} from "@/lib/sesion-clinica-utils";
import type { SesionClinicaResponse } from "@/types/domain";

// SesionClinicaResponse no expone timestamps ni audioR2Key, pero los
// endpoints GET devuelven la fila cruda de Prisma que sí los trae. Se
// aceptan como opcionales para no exigirlos al caller: sin timestamp una
// sesión en "grabando" nunca se considera huérfana (default seguro).
type SesionConMetadatos = SesionClinicaResponse & {
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
  audioR2Key?: string | null;
};

interface SesionHuerfanaBannerProps {
  sesion: SesionConMetadatos;
  onResuelta: () => void;
}

function horasAbandonada(sesion: SesionConMetadatos): number {
  const referencia = sesion.updatedAt ?? sesion.createdAt ?? null;
  if (referencia == null) return UMBRAL_HUERFANA_HORAS;

  const ms =
    referencia instanceof Date ? referencia.getTime() : Date.parse(referencia);
  if (!Number.isFinite(ms)) return UMBRAL_HUERFANA_HORAS;

  return Math.max(
    UMBRAL_HUERFANA_HORAS,
    Math.floor((Date.now() - ms) / (60 * 60 * 1000)),
  );
}

async function parseApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? fallback;
}

export function SesionHuerfanaBanner({
  sesion,
  onResuelta,
}: SesionHuerfanaBannerProps) {
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDescartar, setConfirmDescartar] = React.useState(false);

  if (!esSesionHuerfana(sesion)) {
    return null;
  }

  const esError = sesion.estado === "error";
  const tieneAudio =
    (sesion.audioR2Key != null && sesion.audioR2Key !== "dev-no-r2") ||
    sesion.duracionAudioSeg != null;
  const puedeReintentar = esError && tieneAudio;

  const mensaje = esError
    ? puedeReintentar
      ? "El procesamiento falló."
      : "El procesamiento falló y no hay audio para reintentar."
    : `Quedó una grabación sin completar de hace ${horasAbandonada(sesion)} horas.`;

  const handleReintentar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "procesando" }),
      });
      if (!res.ok) {
        throw new Error(
          await parseApiError(
            res,
            "No pudimos reintentar el procesamiento. Intentá de nuevo.",
          ),
        );
      }
      onResuelta();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos reintentar el procesamiento. Intentá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  };

  // Doble-tap de confirmación (mismo patrón que NotaClinicaView): el primer
  // click arma la confirmación, el segundo ejecuta el DELETE.
  const handleDescartar = async () => {
    if (!confirmDescartar) {
      setConfirmDescartar(true);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesion.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(
          await parseApiError(
            res,
            "No pudimos descartar la sesión. Intentá de nuevo.",
          ),
        );
      }
      onResuelta();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos descartar la sesión. Intentá de nuevo.",
      );
      setConfirmDescartar(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section
      role="alert"
      className="rounded-lg border-2 border-terracotta-500 bg-terracotta-50 px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={22}
            strokeWidth={1.9}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[18px] font-medium text-ink-900">
              {esError ? "Sesión con error" : "Grabación sin completar"}
            </h2>
            <p className="font-sans text-[14px] leading-[1.6] text-ink-700">
              {mensaje}
            </p>
            {esError && sesion.error && (
              <p className="font-sans text-[13px] leading-[1.5] text-ink-500">
                {sesion.error}
              </p>
            )}
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="font-sans text-[14px] text-[color:var(--color-error)]"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleDescartar}
              disabled={enviando}
              className="!text-terracotta-500"
            >
              {confirmDescartar ? "Confirmá: descartar" : "Descartar"}
            </Button>
            {confirmDescartar && (
              <button
                type="button"
                onClick={() => setConfirmDescartar(false)}
                className="font-sans text-[13px] text-ink-500 underline-offset-2 hover:underline"
                disabled={enviando}
              >
                Cancelar
              </button>
            )}
          </div>
          {puedeReintentar && (
            <Button
              type="button"
              variant="primary"
              onClick={handleReintentar}
              disabled={enviando}
              className="w-full sm:w-auto"
            >
              {enviando ? "Reintentando…" : "Reintentar"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
