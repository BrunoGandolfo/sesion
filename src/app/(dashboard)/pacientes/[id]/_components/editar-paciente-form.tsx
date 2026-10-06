"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CamposPaciente } from "@/components/forms/campos-paciente";
import { Button, Card } from "@/components/ui";
import { apiPatch, mensajeParaElla } from "@/lib/api-client";

import { pacienteCreateSchema } from "@/app/api/_lib/schemas";

// La misma regla del alta y del servidor. La copia que vivía acá aceptaba
// tarifa 0 y el PATCH la rechazaba con "Datos inválidos".
const editarPacienteSchema = pacienteCreateSchema.omit({ notas: true });

type EditarPacienteFormValues = z.input<typeof editarPacienteSchema>;

export interface EditarPacienteFormProps {
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    telefono: string;
    tarifa: number;
  };
  /** Guardó: `aviso` es lo que se le confirma a ella. */
  onSuccess: (aviso: string) => void;
  onCancel: () => void;
}

/** Lo que responde PATCH /api/pacientes/[id] y le importa a este formulario.
 *  `turnosActualizados` llega cuando el servidor reescribe la tarifa de los
 *  turnos futuros; mientras no lo mande, el aviso es el de siempre. */
type RespuestaEdicion = { turnosActualizados?: unknown } | null | undefined;

/** El aviso al guardar: si la tarifa cambió y el servidor actualizó turnos
 *  futuros, dice cuántos; si no, el de siempre. */
export function avisoAlGuardar(tarifaCambio: boolean, respuesta: RespuestaEdicion): string {
  const n = respuesta?.turnosActualizados;
  if (!tarifaCambio || typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return "Paciente actualizado";
  }
  return n === 1
    ? "Tarifa guardada. Se actualizó 1 turno futuro."
    : `Tarifa guardada. Se actualizaron ${n} turnos futuros.`;
}

export function EditarPacienteForm({
  paciente,
  onSuccess,
  onCancel,
}: EditarPacienteFormProps) {
  const [apiError, setApiError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditarPacienteFormValues>({
    resolver: zodResolver(editarPacienteSchema),
    defaultValues: {
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      telefono: paciente.telefono,
      tarifa: paciente.tarifa,
    },
    mode: "onSubmit",
  });

  // Ya normalizado por el schema del servidor (teléfono en E.164, textos
  // recortados): no hace falta volver a limpiarlo acá.
  async function submit(values: z.output<typeof editarPacienteSchema>) {
    setApiError(null);

    try {
      const respuesta = await apiPatch<RespuestaEdicion>(`/api/pacientes/${paciente.id}`, {
        nombre: values.nombre,
        apellido: values.apellido,
        telefono: values.telefono,
        tarifa: values.tarifa,
      });
      onSuccess(avisoAlGuardar(values.tarifa !== paciente.tarifa, respuesta));
    } catch (err) {
      setApiError(mensajeParaElla(err));
    }
  }

  return (
    <div className="flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-6 pb-5 pt-3 md:px-8 md:pb-5 md:pt-7">
        <h2 className="font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Editar paciente
        </h2>
      </div>

      <Card className="m-0 flex-1 overflow-y-auto !rounded-none !border-0 !p-0 !shadow-none">
        <form className="flex min-h-full flex-col" onSubmit={handleSubmit(submit)} noValidate>
          <div className="flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
            <div className="space-y-5">
              <CamposPaciente register={register} errors={errors} nombreEnFila />

              {apiError && (
                <p role="alert" className="text-[12px] text-[color:var(--color-error)]">{apiError}</p>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[color:var(--border-subtle)] px-6 pb-6 pt-4 md:px-8 md:pb-6 md:pt-[18px]">
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
