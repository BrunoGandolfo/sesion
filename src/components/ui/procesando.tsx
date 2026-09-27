// "Procesando la sesión de …": lo que muestran la ficha y Hoy mientras el
// worker escribe la nota. Reemplaza al renglón gris "Escribiendo la nota…",
// que no se movía y no decía de quién era.
//
// El anillo es el mismo AnilloProgreso de siempre, girando con la clase
// .gira-procesando de globals.css (la única excepción a "los indicadores de
// carga quedan quietos"); con movimiento reducido queda quieto.
//
// Sin "use client": no tiene estado ni efectos, lo puede dibujar cualquiera.

import { PROCESANDO_DETALLE, procesandoSesionDe } from "@/lib/glosario";

import { AnilloProgreso } from "./movimiento";

export function IndicadorProcesando({
  paciente,
  className = "",
}: {
  paciente: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-md border border-sage-200 bg-white px-4 py-3 ${className}`}
    >
      <span className="gira-procesando mt-[1px] inline-flex shrink-0 text-sage-600">
        <AnilloProgreso tamano={20} />
      </span>
      <span className="min-w-0">
        <span className="block font-sans text-[15px] font-semibold leading-snug text-ink-900">
          {procesandoSesionDe(paciente)}
        </span>
        <span className="mt-0.5 block font-sans text-[13px] leading-snug text-ink-700">
          {PROCESANDO_DETALLE}
        </span>
      </span>
    </div>
  );
}
