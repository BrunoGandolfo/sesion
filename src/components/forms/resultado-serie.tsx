"use client";

import { Button, Sheet } from "@/components/ui";
import { fechaLarga } from "@/lib/format";
import type { SerieCreada } from "@/types/domain";

// No vence: la profesional puede necesitar anotar varias fechas omitidas.
// Textos pendientes de integración: docs/pendientes/series-ui.md.
export function ResultadoSerie({ serie, onClose }: {
  serie: SerieCreada | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={serie !== null} onClose={onClose} ariaLabel="Serie agendada">
      {serie && (
        <div className="space-y-4 px-6 py-5 lg:px-7">
          <h2 className="font-display text-[22px] text-ink-900">Serie agendada</h2>
          <p role="status">{serie.creados === 1 ? "1 turno agendado" : serie.creados + " turnos agendados"}</p>
          {serie.omitidas.length > 0 ? (
            <div className="space-y-2">
              <p>Estas fechas quedaron sin agendar por un choque de horario:</p>
              <ul className="list-disc space-y-1 pl-5">
                {serie.omitidas.map((fecha) => {
                  const instante = new Date(fecha);
                  return <li key={instante.toISOString()}>{fechaLarga(instante)}</li>;
                })}
              </ul>
              <p className="text-[13px] text-ink-500">Podés agendarlas por separado en otro horario.</p>
            </div>
          ) : <p>Se agendaron todas las fechas de la serie.</p>}
          <Button onClick={onClose} className="w-full">Entendido</Button>
        </div>
      )}
    </Sheet>
  );
}
