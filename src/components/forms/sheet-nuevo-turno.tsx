"use client";

// Agendar un turno: el sheet con el formulario, el mismo en Hoy y en la
// Agenda. Las pacientes y la tarifa se piden cada vez que se abre: si se
// creó una paciente desde el formulario, la próxima vez aparece, y si la
// lectura falla se puede reintentar en vez de quedar con la lista vacía
// hasta recargar la pantalla (forense 03, P3-18).

import * as React from "react";
import { CalendarX2 } from "lucide-react";

import { Sheet } from "@/components/ui";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { leerPacientesParaAgendar } from "@/lib/agendar-turno";
import {
  AGENDAR_TURNO,
  ALGO_FALLO,
  CARGANDO_PACIENTES,
  PACIENTES_NO_CARGARON,
  REINTENTAR,
} from "@/lib/glosario";
import type { PacienteConDeuda } from "@/types/domain";

import { NuevoTurnoForm, type NuevoTurnoData } from "./nuevo-turno-form";

type Lectura =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "lista"; pacientes: PacienteConDeuda[]; tarifaDefault: number | null };

export function SheetNuevoTurno({
  open,
  fechaInicial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** El día que se estaba mirando (Agenda). */
  fechaInicial?: Date | null;
  onClose: () => void;
  /** Crea el turno. Lanza ApiClientError si la API lo rechaza: el
   *  formulario muestra el motivo y se queda abierto. */
  onSubmit: (valores: NuevoTurnoData) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel={AGENDAR_TURNO} formulario>
      <div className="px-6 pt-3 lg:px-7 lg:pt-7">
        {open ? (
          <Contenido fechaInicial={fechaInicial} onClose={onClose} onSubmit={onSubmit} />
        ) : null}
      </div>
    </Sheet>
  );
}

// Se monta al abrir y se desmonta al cerrar: cada apertura lee de nuevo.
function Contenido({
  fechaInicial,
  onClose,
  onSubmit,
}: {
  fechaInicial?: Date | null;
  onClose: () => void;
  onSubmit: (valores: NuevoTurnoData) => Promise<void>;
}) {
  const [lectura, setLectura] = React.useState<Lectura>({ tipo: "cargando" });
  const [intento, setIntento] = React.useState(0);

  React.useEffect(() => {
    let vigente = true;
    leerPacientesParaAgendar()
      .then(({ pacientes, tarifaDefault }) => {
        if (vigente) setLectura({ tipo: "lista", pacientes, tarifaDefault });
      })
      .catch(() => {
        if (vigente) setLectura({ tipo: "error" });
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  if (lectura.tipo === "error") {
    return (
      <EstadoVacio
        icono={<CalendarX2 size={28} strokeWidth={1.6} aria-hidden="true" />}
        titulo={ALGO_FALLO}
        lineas={PACIENTES_NO_CARGARON}
        accion={{
          label: REINTENTAR,
          onClick: () => {
            setLectura({ tipo: "cargando" });
            setIntento((n) => n + 1);
          },
        }}
      />
    );
  }
  if (lectura.tipo === "cargando") {
    return (
      <div className="py-14 text-center text-[13px] text-ink-500">{CARGANDO_PACIENTES}</div>
    );
  }
  return (
    <NuevoTurnoForm
      pacientes={lectura.pacientes}
      tarifaDefault={lectura.tarifaDefault}
      fechaInicial={fechaInicial}
      onSubmit={onSubmit}
      onCancel={onClose}
    />
  );
}
