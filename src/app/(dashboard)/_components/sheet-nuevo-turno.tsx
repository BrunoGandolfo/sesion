"use client";

// Agendar un turno desde Hoy. La lista de pacientes se pide recién al abrir
// el sheet (la pantalla de Hoy no la necesita para nada más), así que hasta
// que llega se muestra el aviso de carga en lugar del formulario.

import { Sheet } from "@/components/ui";
import { NuevoTurnoForm } from "@/components/forms";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import type { PacienteConDeuda } from "@/types/domain";

export function SheetNuevoTurno({
  open,
  pacientes,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** null mientras la lista todavía no llegó. */
  pacientes: PacienteConDeuda[] | null;
  onClose: () => void;
  onSubmit: (valores: NuevoTurnoData) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Agendar turno" formulario>
        {pacientes === null ? (
          <div className="px-6 py-14 text-center text-[13px] text-ink-500">
            Cargando pacientes…
          </div>
        ) : (
          <NuevoTurnoForm
            pacientes={pacientes}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        )}
    </Sheet>
  );
}
