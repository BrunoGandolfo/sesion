// Piezas chicas que comparten el núcleo de "Para vos" y los bloques de cada
// instrumento: la cita con su marca de tiempo, los títulos y el plegable de
// ítems.

import type * as React from "react";

import { Plegable } from "@/components/ui";
import { VER_DETALLE, pluralizar } from "@/lib/glosario";
import type { EvidenciaFeedback } from "@/types/domain";

/** Cita literal con timestamp. Exportado para reutilizar el patrón fuera
 *  del feedback (ej. RiesgoDetectadoBanner): EvidenciaRiesgo comparte el
 *  shape { timestamp, quote } y es asignable estructuralmente. */
export function EvidenceItem({ evidencia }: { evidencia: EvidenciaFeedback }) {
  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-cream-200 pl-3">
      {evidencia.timestamp && (
        <span className="text-[11px] font-semibold tabular-nums text-ink-500">
          {evidencia.timestamp}
        </span>
      )}
      <span className="font-sans text-[13px] italic leading-[1.5] text-ink-700">
        “{evidencia.quote}”
      </span>
    </li>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-[16px] font-medium text-ink-900">
      {children}
    </h3>
  );
}

/** Cabecera de un instrumento de auto-supervisión: sigla, nombre completo y
 *  la línea de ayuda del glosario. La sigla NUNCA se reemplaza — es lo que
 *  le permite a la profesional rastrear qué se le está midiendo. */
export function TituloInstrumento({
  instrumento,
}: {
  instrumento: { sigla: string; nombre: string; ayuda: string };
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionTitle>{instrumento.sigla}</SectionTitle>
      <p className="font-sans text-[13px] leading-[1.5] text-ink-500">
        {instrumento.nombre} — {instrumento.ayuda}
      </p>
    </div>
  );
}

/** "Ver detalle · N ítems": los ítems del instrumento, plegados. Los nombres
 *  de dimensiones e ítems no se tocan. */
export function DetalleDeItems({
  cantidad,
  children,
}: {
  cantidad: number;
  children: React.ReactNode;
}) {
  return (
    <Plegable titulo={`${VER_DETALLE} · ${pluralizar(cantidad, "ítem", "ítems")}`}>
      {children}
    </Plegable>
  );
}
