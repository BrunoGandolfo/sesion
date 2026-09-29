"use client";

import * as React from "react";
import { esMismoDiaMvd } from "@/lib/fechas-montevideo";

import { SessionRow } from "@/components/ui";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { EstadoVacio } from "@/components/ui/estado-vacio";
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
        .filter((t) => esMismoDiaMvd(t.fecha, date))
        .sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
    [turnos, date],
  );

  if (delDia.length === 0) {
    // Un día sin turnos enseña el próximo paso, no informa una falta: es de
    // los dos estados vacíos donde entra Lupita (docs/diseno/04-personaje.md).
    return (
      <EstadoVacio
        lupita="saluda"
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
