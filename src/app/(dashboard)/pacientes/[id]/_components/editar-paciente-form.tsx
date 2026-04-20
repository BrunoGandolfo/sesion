"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Card, Input } from "@/components/ui";

const emailSchema = z.email("Ingresá un email válido");

const editarPacienteSchema = z.object({
  nombre: z.string().trim().min(1, "Ingresá el nombre"),
  apellido: z.string().trim().min(1, "Ingresá el apellido"),
  telefono: z.string().trim().min(1, "Ingresá el teléfono"),
  email: z
    .string()
    .trim()
    .refine((value) => value === "" || emailSchema.safeParse(value).success, {
      message: "Ingresá un email válido",
    }),
  tarifa: z
    .number("Ingresá una tarifa")
    .int("Usá pesos sin centavos")
    .min(0, "La tarifa no puede ser negativa"),
});

type EditarPacienteFormValues = z.infer<typeof editarPacienteSchema>;

export interface EditarPacienteFormProps {
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    telefono: string;
    email: string | null;
    tarifa: number;
  };
  onSuccess: () => void;
  onCancel: () => void;
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
      email: paciente.email ?? "",
      tarifa: paciente.tarifa,
    },
    mode: "onSubmit",
  });

  async function submit(values: EditarPacienteFormValues) {
    setApiError(null);

    try {
      const response = await fetch(`/api/pacientes/${paciente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: values.nombre.trim(),
          apellido: values.apellido.trim(),
          telefono: values.telefono.trim(),
          email: values.email.trim() || null,
          tarifa: values.tarifa,
        }),
      });

      if (!response.ok) {
        throw new Error("No se pudieron guardar los cambios.");
      }

      onSuccess();
    } catch {
      setApiError("No se pudieron guardar los cambios.");
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
        <form
          className="flex min-h-full flex-col"
          onSubmit={handleSubmit(submit)}
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Nombre"
                  autoComplete="given-name"
                  error={errors.nombre?.message}
                  {...register("nombre")}
                />
                <Input
                  label="Apellido"
                  autoComplete="family-name"
                  error={errors.apellido?.message}
                  {...register("apellido")}
                />
              </div>

              <Input
                label="Teléfono"
                autoComplete="tel"
                error={errors.telefono?.message}
                {...register("telefono")}
              />

              <Input
                label="Email"
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                {...register("email")}
              />

              <Input
                label="Tarifa"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                prefix="$"
                error={errors.tarifa?.message}
                {...register("tarifa", { valueAsNumber: true })}
              />

              {apiError && (
                <p className="text-[12px] text-[color:var(--color-error)]">
                  {apiError}
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
                {isSubmitting ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
