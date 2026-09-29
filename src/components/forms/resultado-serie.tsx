"use client";

import { Button, Sheet } from "@/components/ui";
import { fechaLarga } from "@/lib/format";
import {
  ENTENDIDO,
  SERIE_AGENDADA,
  SERIE_AGENDADA_TITULO,
  SERIE_AGENDAR_POR_SEPARADO,
  SERIE_FECHAS_SIN_AGENDAR,
  SERIE_TODAS_AGENDADAS,
} from "@/lib/glosario";
import type { SerieCreada } from "@/types/domain";

// No vence: la profesional puede necesitar anotar varias fechas omitidas.
export function ResultadoSerie({ serie, onClose }: {
  serie: SerieCreada | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={serie !== null} onClose={onClose} ariaLabel={SERIE_AGENDADA_TITULO}>
      {serie && (
        <div className="space-y-4 px-6 py-5 lg:px-7">
          <h2 className="font-display text-[22px] text-ink-900">{SERIE_AGENDADA_TITULO}</h2>
          <p role="status">{SERIE_AGENDADA(serie.creados)}</p>
          {serie.omitidas.length > 0 ? (
            <div className="space-y-2">
              <p>{SERIE_FECHAS_SIN_AGENDAR}</p>
              <ul className="list-disc space-y-1 pl-5">
                {serie.omitidas.map((fecha) => {
                  const instante = new Date(fecha);
                  return <li key={instante.toISOString()}>{fechaLarga(instante)}</li>;
                })}
              </ul>
              <p className="text-[13px] text-ink-500">{SERIE_AGENDAR_POR_SEPARADO}</p>
            </div>
          ) : <p>{SERIE_TODAS_AGENDADAS}</p>}
          <Button onClick={onClose} className="w-full">{ENTENDIDO}</Button>
        </div>
      )}
    </Sheet>
  );
}
