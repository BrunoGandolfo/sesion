"use client";

import { LEI_LAS_MENCIONES } from "@/lib/glosario";
import type { DatosEstructurados } from "@/lib/sesion-clinica/schema";

export const CLAVE_MENCIONES = "menciones-lexicas";
export function exigeConfirmarMenciones(datos: DatosEstructurados | null | undefined) {
  const nivel = datos?.riesgoDetectado?.nivel;
  return (datos?.riesgoLexico?.coincidencias.length ?? 0) > 0 && nivel !== "moderado" && nivel !== "alto";
}

export function MencionesNota({ datos, editable, revisada, onRevisar }: {
  datos: DatosEstructurados | null | undefined; editable: boolean; revisada: boolean;
  onRevisar?: (clave: string, marcada: boolean) => void;
}) {
  const menciones = datos?.riesgoLexico?.coincidencias ?? [];
  if (!menciones.length) return null;
  return <section aria-label="Menciones de la transcripción" className="rounded-lg border border-gold-500/30 bg-cream-100 p-4">
    <h2 className="font-semibold">Frases para revisar</h2>
    <p className="mt-2 text-sm">Estas menciones de la transcripción necesitan tu lectura. Por sí solas no constituyen una evaluación de riesgo.</p>
    <ul className="my-3 space-y-2">
      {menciones.map((mencion, i) => {
        const m = typeof mencion === "object" && mencion !== null ? mencion as Record<string, unknown> : {};
        const cita = typeof m.quote === "string" ? m.quote : typeof m.termino === "string" ? m.termino : typeof mencion === "string" ? mencion : "Mención sin cita disponible; revisá la transcripción.";
        return <li key={i}><blockquote>{cita}</blockquote>{typeof m.timestamp === "string" ? <span className="text-sm text-ink-500">{m.timestamp}</span> : null}</li>;
      })}
    </ul>
    {editable && exigeConfirmarMenciones(datos) ? <label className="flex items-center gap-2"><input type="checkbox" checked={revisada} onChange={e => onRevisar?.(CLAVE_MENCIONES, e.target.checked)} />{LEI_LAS_MENCIONES}</label> : null}
  </section>;
}
