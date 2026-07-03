"use client";

import { AlertTriangle } from "lucide-react";

import { EvidenceItem } from "@/components/grabacion/FeedbackTerapeutaView";
import { normalizarRiesgo } from "@/types/domain";
import type { NivelRiesgo } from "@/types/domain";

interface RiesgoDetectadoBannerProps {
  /** Valor crudo de datosEstructurados.riesgoDetectado. Es unknown porque
   *  hay rutas de lectura que no validan shape (coerceDatosEstructurados,
   *  JSON.parse directo en historia-tab); la normalización del contrato
   *  ocurre acá adentro. */
  riesgoDetectado: unknown;
}

const NIVEL_LABELS: Record<Exclude<NivelRiesgo, "ninguno">, string> = {
  bajo: "Nivel bajo",
  moderado: "Nivel moderado",
  alto: "Nivel alto",
};

/** Señal graduada de riesgo clínico sobre la nota (ver
 *  docs/contrato-riesgo-clinico.md). Acompaña el juicio clínico, no lo
 *  reemplaza: informativa, nunca bloqueante. Con nivel "ninguno" (incluye
 *  campo ausente o inválido, vía normalizarRiesgo) no renderiza nada. */
export function RiesgoDetectadoBanner({
  riesgoDetectado,
}: RiesgoDetectadoBannerProps) {
  const riesgo = normalizarRiesgo(riesgoDetectado);
  const { nivel, indicadores, evidencia, notaParaTerapeuta } = riesgo;

  if (nivel === "ninguno") return null;

  const esAlto = nivel === "alto";
  const nota = notaParaTerapeuta?.trim();

  return (
    <section
      role="status"
      aria-label="Señales a observar"
      className={
        esAlto
          ? "rounded-lg border-2 border-terracotta-500 bg-terracotta-50/70 px-4 py-4 sm:px-5"
          : "rounded-lg border border-terracotta-100 border-l-4 border-l-terracotta-500 bg-terracotta-50/70 px-4 py-4 sm:px-5"
      }
    >
      <div className="flex items-start gap-3">
        {esAlto && (
          <AlertTriangle
            size={20}
            strokeWidth={1.9}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
              Señales a observar
            </p>
            <span className="font-display text-[15px] font-medium text-ink-900">
              {NIVEL_LABELS[nivel]}
            </span>
          </div>

          {indicadores.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {indicadores.map((indicador, index) => (
                <li
                  key={`${indicador}-${index}`}
                  className="font-sans text-[14px] leading-[1.6] text-ink-900"
                >
                  {indicador}
                </li>
              ))}
            </ul>
          )}

          {nota ? (
            <p className="font-sans text-[14px] leading-[1.65] text-ink-900">
              {nota}
            </p>
          ) : null}

          {evidencia.length > 0 && (
            <details>
              <summary className="cursor-pointer list-none font-sans text-[12px] font-semibold text-ink-500 transition-colors duration-150 hover:text-ink-700 [&::-webkit-details-marker]:hidden">
                {evidencia.length === 1
                  ? "Ver 1 cita de la transcripción"
                  : `Ver ${evidencia.length} citas de la transcripción`}
              </summary>
              <ul className="flex flex-col gap-1.5 pt-1.5">
                {evidencia.map((ev, index) => (
                  <EvidenceItem
                    key={`${ev.timestamp}-${index}`}
                    evidencia={ev}
                  />
                ))}
              </ul>
            </details>
          )}

          <p className="font-sans text-[12px] italic leading-[1.5] text-ink-500">
            Detectado desde la transcripción — evaluá con tu criterio clínico.
          </p>
        </div>
      </div>
    </section>
  );
}
