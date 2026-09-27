// "Procesando la sesión de …": lo que muestran la ficha y Hoy mientras el
// worker escribe la nota. Reemplaza al renglón gris "Escribiendo la nota…",
// que no se movía y no decía de quién era.
//
// El anillo es el mismo AnilloProgreso de siempre, girando con la clase
// .gira-procesando de globals.css (la única excepción a "los indicadores de
// carga quedan quietos"); con movimiento reducido queda quieto.
//
// Sin "use client": no tiene estado ni efectos. Con `conLupita` dibuja a
// Lupita, que sí los tiene: esa variante la pide sólo Hoy, que es cliente.
//
// CON LUPITA
//
// En la lista de Hoy, Lupita se sienta en el lugar del anillo, concentrada,
// mientras la nota se escribe (docs/diseno/06-lupita-presencia.md). Sólo
// ahí: `conLupita` es falso por defecto porque este renglón también sale en
// la card de ahora (que lleva el brief), en la ficha y en la nota, donde el
// personaje no entra. Quien la pide decide además la regla del riesgo: en
// Hoy, un día con riesgo, no.

import { PROCESANDO_DETALLE, procesandoSesionDe } from "@/lib/glosario";

import { Lupita, TAMANOS_LUPITA } from "./lupita";
import { AnilloProgreso } from "./movimiento";

export function IndicadorProcesando({
  paciente,
  className = "",
  conLupita = false,
}: {
  paciente: string;
  className?: string;
  conLupita?: boolean;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-md border border-sage-200 bg-white px-4 py-3 ${className}`}
    >
      {conLupita ? (
        <span className="-my-1 inline-flex shrink-0">
          <Lupita pose="concentrada" tamano={TAMANOS_LUPITA.junto} movimiento="respira" />
        </span>
      ) : (
        <span className="gira-procesando mt-[1px] inline-flex shrink-0 text-sage-600">
          <AnilloProgreso tamano={20} />
        </span>
      )}
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
