"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Textarea } from "@/components/ui";
import type { Paciente } from "@/types/domain";

const schema = z.object({
  nombre: z.string().trim().min(1, "Ingresá el nombre"),
  apellido: z.string().trim().min(1, "Ingresá el apellido"),
  telefono: z.string().trim().min(8, "Ingresá el teléfono"),
  email: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) =>
        !value ||
        value.length === 0 ||
        z.string().email().safeParse(value).success,
      { message: "Email inválido" },
    ),
  tarifa: z
    .number({ error: "Ingresá la tarifa" })
    .positive("La tarifa debe ser mayor a 0"),
  notas: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export interface NuevoPacienteFormProps {
  tarifaDefault?: number;
  onSuccess: (paciente: Paciente) => void;
  onCancel: () => void;
}

export function NuevoPacienteForm({
  tarifaDefault = 2200,
  onSuccess,
  onCancel,
}: NuevoPacienteFormProps) {
  const tarifaId = React.useId();
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nombre: "",
      apellido: "",
      telefono: "",
      email: "",
      tarifa: tarifaDefault,
      notas: "",
    },
    mode: "onSubmit",
  });

  async function submit(values: FormValues) {
    setSubmitError(null);
    try {
      const response = await fetch("/api/pacientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: values.nombre.trim(),
          apellido: values.apellido.trim(),
          telefono: values.telefono.trim(),
          email:
            values.email && values.email.trim().length > 0
              ? values.email.trim()
              : null,
          tarifa: values.tarifa,
          notas:
            values.notas && values.notas.trim().length > 0
              ? values.notas.trim()
              : null,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "No se pudo crear el paciente");
      }

      const json = (await response.json()) as { data: Paciente };
      reset();
      onSuccess(json.data);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "No se pudo crear el paciente",
      );
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
            <Input
              label="Teléfono"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+598 99 123 456"
              error={errors.telefono?.message}
              {...register("telefono")}
            />
            <Input
              label="Email (opcional)"
              type="email"
              inputMode="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register("email")}
            />

            <div>
              <label
                htmlFor={tarifaId}
                className="block font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 mb-2"
              >
                Tarifa por sesión
              </label>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-500 pointer-events-none z-10"
                >
                  $UYU
                </span>
                <Input
                  id={tarifaId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  className="pl-[56px] tabular-nums"
                  aria-invalid={errors.tarifa ? true : undefined}
                  {...register("tarifa", { valueAsNumber: true })}
                />
              </div>
              {errors.tarifa?.message && (
                <p
                  role="alert"
                  className="mt-2 text-[12px] font-sans text-[color:var(--color-error)]"
                >
                  {errors.tarifa.message}
                </p>
              )}
            </div>

            <Textarea
              label="Notas (opcional)"
              placeholder="Observaciones sobre el paciente"
              error={errors.notas?.message}
              {...register("notas")}
            />

            {submitError && (
              <p
                role="alert"
                className="text-[12px] font-sans text-[color:var(--color-error)]"
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
