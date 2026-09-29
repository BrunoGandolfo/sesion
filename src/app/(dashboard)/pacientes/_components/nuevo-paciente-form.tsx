"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { CamposPaciente } from "@/components/forms/campos-paciente";
import { Button, Textarea } from "@/components/ui";
import { apiPost, mensajeParaElla } from "@/lib/api-client";

import { pacienteCreateSchema } from "@/app/api/_lib/schemas";
import type { Paciente } from "@/types/domain";

// Una sola regla para el alta de una paciente: la del servidor. Antes el
// formulario tenía la suya (teléfono mínimo 8, tarifa positiva pero no
// entera) y la edición otra más (tarifa entera pero ≥ 0, que el POST
// rechaza). Tres copias de la misma cosa, y ninguna igual a la que decide.
type FormValues = z.input<typeof pacienteCreateSchema>;

export interface NuevoPacienteFormProps {
  /** Tarifa por sesión de Tu consultorio. Sin ella el campo arranca vacío:
   *  no hay un número inventado. */
  tarifaDefault: number | null;
  onSuccess: (paciente: Paciente) => void;
  onCancel: () => void;
}

export function NuevoPacienteForm({
  tarifaDefault,
  onSuccess,
  onCancel,
}: NuevoPacienteFormProps) {
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(pacienteCreateSchema),
    defaultValues: {
      nombre: "",
      apellido: "",
      telefono: "",
      tarifa: tarifaDefault ?? undefined,
      notas: "",
    },
    mode: "onSubmit",
  });

  // `values` llega ya validado y normalizado por el schema del servidor: el
  // teléfono viene en E.164 y los textos recortados.
  async function submit(values: z.output<typeof pacienteCreateSchema>) {
    setSubmitError(null);
    try {
      const paciente = await apiPost<Paciente>("/api/pacientes", {
        nombre: values.nombre,
        apellido: values.apellido,
        telefono: values.telefono,
        tarifa: values.tarifa,
        notas: values.notas && values.notas.length > 0 ? values.notas : null,
      });
      reset();
      onSuccess(paciente);
    } catch (err) {
      setSubmitError(mensajeParaElla(err));
    }
  }

  return (
    <div className="flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-6 pb-5 pt-3 md:px-8 md:pb-5 md:pt-7">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Nuevo
        </p>
        <h2 className="mt-1 font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Nuevo paciente
        </h2>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit(submit)}
        noValidate
      >
        <div className="flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
          <div className="flex flex-col gap-4">
            <CamposPaciente
              register={register}
              errors={errors}
              sinTarifaDefault={tarifaDefault === null}
            />

            <Textarea
              label="Notas (opcional)"
              placeholder="Observaciones sobre el paciente"
              error={errors.notas?.message}
              {...register("notas")}
            />

            {submitError && (
              <p
                role="alert"
                className="font-sans text-[12px] text-[color:var(--color-error)]"
              >
                {submitError}
              </p>
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
              {isSubmitting ? "Creando…" : "Crear paciente"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
