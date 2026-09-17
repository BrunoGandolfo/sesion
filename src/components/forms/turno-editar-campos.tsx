"use client";

// Los campos de un turno que se escriben a mano: fecha y hora, duración,
// modalidad y notas. Los usan el formulario de alta (Hoy y Agenda) y el
// bloque "Reprogramar" del detalle del turno. Antes cada uno tenía su copia
// de los botones de duración y del Segmented de modalidad, con su propio
// array de duraciones.
//
// Se engancha al formulario del padre por contexto (FormProvider): el padre
// declara sus valores como `camposTurnoSchema` más lo suyo (paciente,
// frecuencia) y este componente solo toca los cinco campos que conoce.

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";

import { Button, Input, Segmented, Textarea } from "@/components/ui";
import {
  DURACIONES,
  DURACION_DEFAULT,
  MODALIDAD_DEFAULT,
  duracionSchema,
  modalidadSchema,
  type Modalidad,
} from "@/lib/constantes-turno";

export const camposTurnoSchema = z.object({
  fecha: z.string().min(1, "Falta la fecha"),
  hora: z.string().min(1, "Falta la hora"),
  duracion: duracionSchema,
  modalidad: modalidadSchema,
  notas: z.string().optional(),
});

export type CamposTurnoValores = z.infer<typeof camposTurnoSchema>;

/** Lo que arranca un formulario nuevo; el de reprogramar carga el turno. */
export const CAMPOS_TURNO_DEFAULT: CamposTurnoValores = {
  fecha: "",
  hora: "",
  duracion: DURACION_DEFAULT,
  modalidad: MODALIDAD_DEFAULT,
  notas: "",
};

const OPCIONES_MODALIDAD: { value: Modalidad; label: string }[] = [
  { value: "presencial", label: "Presencial" },
  { value: "online", label: "Online" },
];

interface TurnoEditarCamposProps {
  /** Rótulo del campo de notas: en el alta dice que es opcional. */
  notasLabel?: string;
  /** Avisa que la usuaria escribió la fecha o la hora a mano. El alta lo usa
   *  para que la propuesta que llega después no le pise lo que escribió;
   *  "Reprogramar" no lo necesita y no lo pasa. */
  onFechaUHoraEditada?: () => void;
  /** Se dibuja entre fecha/hora y duración (la propuesta de fecha). */
  children?: React.ReactNode;
}

export function TurnoEditarCampos({
  notasLabel = "Notas (opcional)",
  onFechaUHoraEditada,
  children,
}: TurnoEditarCamposProps) {
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useFormContext<CamposTurnoValores>();
  const duracion = useWatch({ control, name: "duracion" });
  const modalidad = useWatch({ control, name: "modalidad" });

  // El onChange propio se compone con el de react-hook-form en vez de pasarlo
  // por las opciones de register: así el aviso sale del evento real del
  // input, sin depender de cómo encadene register las dos funciones.
  const campoFecha = register("fecha");
  const campoHora = register("hora");
  const conAviso = <T,>(
    alCambiar: (evento: T) => unknown,
  ) => (evento: T) => {
    alCambiar(evento);
    onFechaUHoraEditada?.();
  };

  return (
    <>
      <input type="hidden" {...register("duracion", { valueAsNumber: true })} />
      <input type="hidden" {...register("modalidad")} />

      {/* Fecha y hora */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Fecha"
          type="date"
          error={errors.fecha?.message}
          {...campoFecha}
          onChange={conAviso(campoFecha.onChange)}
        />
        <Input
          label="Hora"
          type="time"
          error={errors.hora?.message}
          {...campoHora}
          onChange={conAviso(campoHora.onChange)}
        />
      </div>

      {children}

      {/* Duración */}
      <div className="space-y-2">
        <span className="block font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Duración
        </span>
        <div className="flex gap-2">
          {DURACIONES.map((opcion) => {
            const activo = duracion === opcion;
            return (
              <Button
                key={opcion}
                type="button"
                size="sm"
                variant="secondary"
                aria-pressed={activo}
                onClick={() =>
                  setValue("duracion", opcion, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                className={`flex-1 !px-0 border ${
                  activo
                    ? "!border-sage-500 !bg-sage-500 !text-white hover:!bg-sage-500"
                    : "!border-[color:var(--border-subtle)] !bg-cream-50 !text-ink-700 hover:!bg-cream-100"
                }`}
              >
                {opcion}′
              </Button>
            );
          })}
        </div>
      </div>

      {/* Modalidad */}
      <div className="space-y-2">
        <span className="block font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Modalidad
        </span>
        <Segmented
          ariaLabel="Modalidad"
          value={modalidad}
          onChange={(valor: Modalidad) =>
            setValue("modalidad", valor, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          options={OPCIONES_MODALIDAD}
        />
      </div>

      <Textarea
        label={notasLabel}
        placeholder="Algo para recordar del turno."
        error={errors.notas?.message}
        className="min-h-[72px]"
        {...register("notas")}
      />
    </>
  );
}
