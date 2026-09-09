"use client";

import * as React from "react";
import { isSameDay } from "date-fns";

import { Button, Lupita, SessionRow } from "@/components/ui";
import { TAMANOS_LUPITA } from "@/components/ui/lupita";
import { ListaEnCascada } from "@/components/ui/movimiento";
import {
  AGENDAR,
  AGENDA_DIA_VACIO_LINEAS,
  AGENDA_DIA_VACIO_TITULO,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

interface Props {
  date: Date;
  turnos: TurnoConPaciente[];
  onOpenTurno: (turno: TurnoConPaciente) => void;
  onNuevoTurno: () => void;
  /**
   * El turno que se acaba de cobrar, mientras dura el respiro de
   * `useConfirmacionDibujada` en la pantalla (D9). Su fila queda con el
   * trazo del check ahí donde ella tocó, en vez de cambiar de chip sin que
   * nada diga que ese cambio es consecuencia de lo que hizo.
   */
  turnoCobradoId?: string | null;
}

export function DayView({
  date,
  turnos,
  onOpenTurno,
  onNuevoTurno,
  turnoCobradoId = null,
}: Props) {
  const delDia = React.useMemo(
    () =>
      turnos
        .filter((t) => isSameDay(t.fecha, date))
        .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
    [turnos, date],
  );

  if (delDia.length === 0) {
    // Un día sin turnos enseña el próximo paso, no informa una falta: es de
    // los dos estados vacíos donde entra Lupita (docs/diseno/04-personaje.md).
    return (
      <EstadoVacio
        icono={<Lupita pose="saluda" tamano={TAMANOS_LUPITA.vacio} />}
        circulo="grande"
        titulo={AGENDA_DIA_VACIO_TITULO}
        lineas={AGENDA_DIA_VACIO_LINEAS}
        accion={{ label: AGENDAR, onClick: onNuevoTurno }}
      />
    );
  }

  // D7: la misma fila entra igual acá que en Hoy, en Cobros y en la ficha.
  return (
    <ListaEnCascada className="flex flex-col gap-2">
      {delDia.map((turno) => (
        <SessionRow
          key={turno.id}
          turno={turno}
          cobroConfirmado={turno.id === turnoCobradoId}
          onClick={() => onOpenTurno(turno)}
        />
      ))}
    </ListaEnCascada>
  );
}

/**
 * Estado vacío de la agenda: ícono, titular, tres líneas, un botón.
 *
 * `circulo` es el tamaño del disco crema: "chico" (56 px) para un ícono de
 * lucide —los errores usan este componente y ahí NO va el personaje, que no
 * tiene pose de error— y "grande" para Lupita a 96 px.
 */
export function EstadoVacio({
  icono,
  titulo,
  lineas,
  accion,
  circulo = "chico",
}: {
  icono: React.ReactNode;
  titulo: string;
  lineas: [string, string, string];
  accion: { label: string; onClick: () => void };
  circulo?: "chico" | "grande";
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-12 text-center">
      <span
        className={`inline-flex items-center justify-center rounded-full bg-cream-100 text-sage-600 ${
          circulo === "grande" ? "h-[132px] w-[132px]" : "h-14 w-14"
        }`}
      >
        {icono}
      </span>
      <p className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        {titulo}
      </p>
      <div className="mt-3 flex max-w-[420px] flex-col gap-1">
        {lineas.map((linea) => (
          <p key={linea} className="text-[13px] leading-[1.5] text-ink-500">
            {linea}
          </p>
        ))}
      </div>
      <div className="mt-6">
        <Button variant="secondary" onClick={accion.onClick}>
          {accion.label}
        </Button>
      </div>
    </div>
  );
}
