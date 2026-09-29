"use client";

// Los campos de una paciente: nombre, apellido, teléfono y tarifa. Los
// comparten el alta (pacientes/_components/nuevo-paciente-form) y la edición
// (pacientes/[id]/_components/editar-paciente-form), que tenían cada uno los
// suyos y ya se habían separado: en la edición el teléfono abría el teclado
// de letras y el error de la tarifa no se anunciaba (forense 03, P3-19).
//
// La validación es la del servidor (pacienteCreateSchema), en cada
// formulario; acá solo se dibujan los campos y sus errores.

import * as React from "react";
import type { FieldErrors, FieldValues, Path, UseFormRegister } from "react-hook-form";

import { Input } from "@/components/ui";

type Campos = {
  nombre: unknown;
  apellido: unknown;
  telefono: unknown;
  tarifa: unknown;
};

export function CamposPaciente<T extends FieldValues & Campos>({
  register,
  errors,
  sinTarifaDefault = false,
  nombreEnFila = false,
}: {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  /** Tu consultorio no tiene tarifa por defecto: se sugiere cargarla. */
  sinTarifaDefault?: boolean;
  /** Nombre y apellido lado a lado en pantallas anchas (la edición). */
  nombreEnFila?: boolean;
}) {
  const tarifaId = React.useId();
  const error = (campo: keyof Campos) => {
    const mensaje = errors[campo]?.message;
    return typeof mensaje === "string" ? mensaje : undefined;
  };
  const errorTarifa = error("tarifa");

  const nombreYApellido = (
    <>
      <Input
        label="Nombre"
        autoComplete="given-name"
        error={error("nombre")}
        {...register("nombre" as Path<T>)}
      />
      <Input
        label="Apellido"
        autoComplete="family-name"
        error={error("apellido")}
        {...register("apellido" as Path<T>)}
      />
    </>
  );

  return (
    <>
      {nombreEnFila ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{nombreYApellido}</div>
      ) : (
        nombreYApellido
      )}
      <Input
        label="Teléfono"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+598 99 123 456"
        error={error("telefono")}
        {...register("telefono" as Path<T>)}
      />

      <div>
        <label
          htmlFor={tarifaId}
          className="mb-2 block font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"
        >
          Tarifa por sesión
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[14px] top-1/2 z-10 -translate-y-1/2 text-[14px] font-semibold text-ink-500"
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
            aria-invalid={errorTarifa ? true : undefined}
            aria-describedby={errorTarifa ? `${tarifaId}-error` : undefined}
            {...register("tarifa" as Path<T>, { valueAsNumber: true })}
          />
        </div>
        {sinTarifaDefault && !errorTarifa ? (
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">
            Podés fijar una tarifa por defecto en Tu consultorio.
          </p>
        ) : null}
        {errorTarifa ? (
          <p
            id={`${tarifaId}-error`}
            role="alert"
            className="mt-2 font-sans text-[12px] text-[color:var(--color-error)]"
          >
            {errorTarifa}
          </p>
        ) : null}
      </div>
    </>
  );
}
