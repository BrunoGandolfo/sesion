"use client";

import { AlertCircle, CheckCircle2, Lightbulb } from "lucide-react";

import { Plegable } from "@/components/ui";
import { CTSR, GTFS, INSTRUMENTO_Y_PUNTAJE, MITI, PARA_VOS_INCOMPLETO } from "@/lib/glosario";
import type { AreaCrecimientoFeedback, FortalezaFeedback } from "@/types/domain";

import { BloqueGestalt, BloqueMitiCtsr } from "./feedback-instrumentos";
import { hayParaVos, leerFeedback, type FeedbackLegible } from "./feedback-lectura";
import { EvidenceItem, SectionTitle } from "./feedback-piezas";

// La lectura del payload vive en feedback-lectura.ts y los bloques de cada
// instrumento en feedback-instrumentos.tsx; se reexporta lo que otras
// pantallas ya importaban de acá.
export { hayParaVos, leerFeedback } from "./feedback-lectura";
export { EvidenceItem } from "./feedback-piezas";

// "Para vos": la auto-supervisión de una sesión.
//
// Ya no es un bloque al pie de la nota. Vive en su propia vista
// (/sesiones/[id]/para-vos) y este componente dibuja su contenido.
//
// EL ORDEN: PRIMERO LO QUE SE LEE, DESPUÉS CÓMO SE MIDIÓ
//
// Fortalezas, áreas de crecimiento (cada una con su sugerencia) y la
// observación general van arriba y a la vista: están escritas en lenguaje
// llano, con la cita que las sostiene, y son lo que ella vino a buscar. El
// instrumento —sigla, puntajes, ítems— va después, en un plegable cerrado.
// Antes la pantalla arrancaba por "MITI 4.2.1" y un puntaje, y lo útil
// quedaba debajo. No cambió ni se sacó nada del contenido: cambió el orden.
//
// EL GUARDIÁN, QUE ANTES ESCONDÍA
//
// La nota tenía un `esFeedbackRenderizable` que pedía dos arrays y, si
// faltaba alguno, no dibujaba NADA — sin decirlo. El feedback existía, ella
// no se enteraba. Acá el criterio es el opuesto: se lee lo que se pueda, se
// muestra lo que llegó, y si algo faltó se avisa con una línea chica.
// Lo único que devuelve null es un payload que no es un objeto: eso no es
// feedback incompleto, es feedback ausente.
//
// Nada se inventa para tapar el hueco: un bloque de instrumento que no llegó
// entero no se dibuja con ceros ni con "No determinable" —eso sería ponerle
// al modelo palabras que no dijo—, simplemente no se dibuja y el aviso lo
// cuenta.

function FortalezaItem({ fortaleza }: { fortaleza: FortalezaFeedback }) {
  return (
    <li className="flex min-h-[44px] gap-3 py-1">
      <CheckCircle2
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-sage-500"
      />
      <div className="flex flex-col gap-1.5">
        <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
          {fortaleza.descripcion}
        </p>
        {fortaleza.evidence.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {fortaleza.evidence.map((ev, index) => (
              <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function AreaCrecimientoItem({ area }: { area: AreaCrecimientoFeedback }) {
  return (
    <li className="flex min-h-[44px] gap-3 py-1">
      <Lightbulb
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-gold-500"
      />
      <div className="flex flex-col gap-1.5">
        <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
          {area.observacion}
        </p>
        <p className="font-sans text-[13px] leading-[1.55] text-ink-700">
          <span className="font-semibold uppercase tracking-[0.08em] text-[11px] text-ink-500">
            Sugerencia ·{" "}
          </span>
          {area.sugerencia}
        </p>
        {area.evidence.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {area.evidence.map((ev, index) => (
              <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const DISCLAIMER_TEXT =
  "Este análisis es generado por IA a partir de la transcripción. No sustituye la supervisión clínica profesional. Las métricas son orientativas y deben interpretarse en contexto.";

interface FeedbackTerapeutaViewProps {
  /** El payload crudo de `datosEstructurados.feedbackTerapeuta`. Va como
   *  `unknown` porque así viaja en el contrato: la forma se valida acá. */
  feedbackTerapeuta: unknown;
}

export function FeedbackTerapeutaView({
  feedbackTerapeuta,
}: FeedbackTerapeutaViewProps) {
  const feedback = leerFeedback(feedbackTerapeuta);
  // Un análisis con la forma correcta y sin una sola línea adentro no es
  // nada que leer: eso sí se calla. Lo que nunca se calla es un análisis
  // incompleto, que es el caso que este componente vino a arreglar.
  if (!feedback || !hayParaVos(feedbackTerapeuta)) return null;

  const hayNucleo =
    feedback.fortalezas.length > 0 ||
    feedback.areasCrecimiento.length > 0 ||
    feedback.sugerenciaProximaSesion.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      {feedback.completo ? null : <AvisoIncompleto />}

      <NucleoPanteoricoSections nucleo={feedback} />

      {/* Plegado porque arriba hay algo que leer. Si el análisis trajo sólo
          el instrumento, plegarlo dejaría la pantalla en blanco: va abierto. */}
      {feedback.mitiGlobales && feedback.ctsrSubset ? (
        <Plegable titulo={INSTRUMENTO_Y_PUNTAJE} ayuda={`${MITI.sigla} + ${CTSR.sigla}`} abiertoPorDefecto={!hayNucleo}>
          <BloqueMitiCtsr
            mitiGlobales={feedback.mitiGlobales}
            ctsrSubset={feedback.ctsrSubset}
          />
        </Plegable>
      ) : null}

      {feedback.itemsGTFS ? (
        <Plegable titulo={INSTRUMENTO_Y_PUNTAJE} ayuda={GTFS.sigla} abiertoPorDefecto={!hayNucleo}>
          <BloqueGestalt items={feedback.itemsGTFS} />
        </Plegable>
      ) : null}

      <p className="border-t border-cream-200 pt-4 font-sans text-[12px] leading-[1.55] italic text-ink-500">
        {DISCLAIMER_TEXT}
      </p>
    </div>
  );
}

/** El hueco, dicho en una línea. Terracotta como cualquier aviso de la app,
 *  y sin botón: no hay nada que ella pueda reintentar desde acá. */
function AvisoIncompleto() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md bg-terracotta-50 px-3.5 py-2.5 font-sans text-[13px] leading-[1.5] text-terracotta-600"
    >
      <AlertCircle
        size={16}
        strokeWidth={1.9}
        aria-hidden="true"
        className="mt-[2px] shrink-0"
      />
      {PARA_VOS_INCOMPLETO}
    </p>
  );
}

// ─── Núcleo panteórico (compartido por todo instrumento) ─────────────

function NucleoPanteoricoSections({ nucleo }: { nucleo: FeedbackLegible }) {
  const fortalezasVisibles = nucleo.fortalezas.slice(0, 3);
  const areasVisibles = nucleo.areasCrecimiento.slice(0, 3);

  return (
    <>
      {fortalezasVisibles.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle>Fortalezas observadas</SectionTitle>
          <ul className="flex flex-col gap-3">
            {fortalezasVisibles.map((fortaleza, index) => (
              <FortalezaItem
                key={`${fortaleza.descripcion}-${index}`}
                fortaleza={fortaleza}
              />
            ))}
          </ul>
        </div>
      )}

      {areasVisibles.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle>Áreas de crecimiento</SectionTitle>
          <ul className="flex flex-col gap-3">
            {areasVisibles.map((area, index) => (
              <AreaCrecimientoItem
                key={`${area.observacion}-${index}`}
                area={area}
              />
            ))}
          </ul>
        </div>
      )}

      {nucleo.sugerenciaProximaSesion.trim() && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Observación general</SectionTitle>
          <p className="font-sans text-[14px] leading-[1.65] text-ink-900">
            {nucleo.sugerenciaProximaSesion}
          </p>
        </div>
      )}
    </>
  );
}
