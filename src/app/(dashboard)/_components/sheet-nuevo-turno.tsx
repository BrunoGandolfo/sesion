"use client";

// Agendar un turno desde Hoy. Es el mismo formulario que usa la agenda
// (components/forms/nuevo-turno-form). La lista de pacientes y la tarifa se
// piden recién al abrir el sheet (la pantalla de Hoy no las necesita para
// nada más), así que hasta que llegan se muestra el aviso de carga.

import { Sheet } from "@/components/ui";
import { NuevoTurnoForm } from "@/components/forms";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import type { PacienteConDeuda } from "@/types/domain";

export function SheetNuevoTurno({
  open,
  pacientes,
  tarifaDefault = null,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** null mientras la lista todavía no llegó. */
  pacientes: PacienteConDeuda[] | null;
  /** Tarifa de Tu consultorio para "Crear a X"; null si no se pudo leer. */
  tarifaDefault?: number | null;
  onClose: () => void;
  /** Crea el turno. Lanza ApiClientError si la API lo rechaza: el
   *  formulario muestra el motivo y se queda abierto. */
  onSubmit: (valores: NuevoTurnoData) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Agendar turno" formulario>
      <div className="px-6 pt-3 lg:px-7 lg:pt-7">
        {pacientes === null ? (
          <div className="py-14 text-center text-[13px] text-ink-500">
            Cargando pacientes…
          </div>
        ) : (
          <NuevoTurnoForm
            pacientes={pacientes}
            tarifaDefault={tarifaDefault}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        )}
      </div>
    </Sheet>
  );
}
