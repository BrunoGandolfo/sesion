"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button, Card, Input, Segmented, Textarea } from "@/components/ui";
import { avatarColor, initials, money } from "@/lib/format";
import type { Duracion, Modalidad, Paciente } from "@/types/domain";
import { agregarDiasMvd, fechaInputMvd } from "@/lib/fechas-montevideo";

const duraciones: Duracion[] = [30, 45, 50, 60, 90];

const nuevoTurnoSchema = z.object({
  pacienteId: z.string().min(1, "Elegí un paciente"),
  fecha: z.string().min(1, "Falta la fecha"),
  hora: z.string().min(1, "Falta la hora"),
  duracion: z.union([
    z.literal(30),
    z.literal(45),
    z.literal(50),
    z.literal(60),
    z.literal(90),
  ]),
  modalidad: z.enum(["presencial", "online"]),
  notas: z.string().optional(),
});

export interface NuevoTurnoData {
  pacienteId: string;
  fecha: string;
  hora: string;
  duracion: Duracion;
  modalidad: Modalidad;
  notas: string;
}

export interface NuevoTurnoFormProps {
  pacientes: Pick<Paciente, "id" | "nombre" | "apellido" | "tarifa">[];
  onSubmit: (data: NuevoTurnoData) => void;
  onCancel: () => void;
  tarifaDefault?: number;
}

type NuevoTurnoFormValues = z.infer<typeof nuevoTurnoSchema>;

// El día por defecto es mañana en Montevideo, no en la zona del aparato:
// quien envía este formulario lo lee después con instanteDesdeFechaHoraMvd,
// así que los dos lados tienen que hablar del mismo reloj.
function tomorrowDateInputValue() {
  return fechaInputMvd(agregarDiasMvd(new Date(), 1));
}

function fullName(paciente: Pick<Paciente, "nombre" | "apellido">) {
  return `${paciente.nombre} ${paciente.apellido}`.trim();
}

function patientMatches(paciente: Pick<Paciente, "nombre" | "apellido">, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fullName(paciente).toLowerCase().includes(needle);
}

export function NuevoTurnoForm({
  pacientes,
  onSubmit,
  onCancel,
}: NuevoTurnoFormProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const patientListId = React.useId();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<NuevoTurnoFormValues>({
    resolver: zodResolver(nuevoTurnoSchema),
    defaultValues: {
      pacienteId: "",
      fecha: tomorrowDateInputValue(),
      hora: "10:00",
      duracion: 50,
      modalidad: "presencial",
      notas: "",
    },
    mode: "onSubmit",
  });

  const pacienteId = useWatch({ control, name: "pacienteId" });
  const duracion = useWatch({ control, name: "duracion" });
  const modalidad = useWatch({ control, name: "modalidad" });

  const [searchTerm, setSearchTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const selectedPaciente = React.useMemo(
    () => pacientes.find((paciente) => paciente.id === pacienteId) ?? null,
    [pacientes, pacienteId],
  );

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const filteredPacientes = React.useMemo(
    () => pacientes.filter((paciente) => patientMatches(paciente, searchTerm)),
    [pacientes, searchTerm],
  );

  const trimmedSearch = searchTerm.trim();
  const canCreatePaciente = trimmedSearch.length > 0 && filteredPacientes.length === 0;
  const optionCount = filteredPacientes.length + (canCreatePaciente ? 1 : 0);
  const hasOptions = optionCount > 0;

  const effectiveActiveIndex =
    open && optionCount > 0 ? Math.min(activeIndex, optionCount - 1) : 0;

  const selectPaciente = React.useCallback(
    (paciente: Pick<Paciente, "id" | "nombre" | "apellido" | "tarifa">) => {
      setValue("pacienteId", paciente.id, { shouldDirty: true, shouldValidate: true });
      setSearchTerm(fullName(paciente));
      setOpen(false);
      setActiveIndex(0);
    },
    [setValue],
  );

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (selectedPaciente && value !== fullName(selectedPaciente)) {
      setValue("pacienteId", "", { shouldDirty: true, shouldValidate: true });
    }
    setOpen(true);
    setActiveIndex(0);
  };

  const handleSearchFocus = () => {
    setOpen(true);
    setActiveIndex(0);
  };

  const handleSearchBlur = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }

    if (!hasOptions) {
      if (event.key === "Escape") {
        setOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (canCreatePaciente && effectiveActiveIndex === optionCount - 1) {
        setValue("pacienteId", "", { shouldDirty: true, shouldValidate: true });
        setOpen(false);
        return;
      }

      const paciente = filteredPacientes[effectiveActiveIndex];
      if (paciente) selectPaciente(paciente);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const patientFieldError = errors.pacienteId?.message;
  const fechaError = errors.fecha?.message;
  const horaError = errors.hora?.message;
  const duracionError = errors.duracion?.message;
  const modalidadError = errors.modalidad?.message;

  return (
    <div
      ref={rootRef}
      className="flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden bg-white"
    >
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-6 pb-5 pt-3 md:px-8 md:pb-5 md:pt-7">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Nuevo
        </p>
        <h2 className="mt-1 font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Agendar turno
        </h2>
      </div>

      <Card className="m-0 flex-1 overflow-y-auto !rounded-none !border-0 !p-0 !shadow-none">
        <form
          className="flex min-h-full flex-col"
          onSubmit={handleSubmit((values) =>
            onSubmit({
              pacienteId: values.pacienteId,
              fecha: values.fecha,
              hora: values.hora,
              duracion: values.duracion,
              modalidad: values.modalidad,
              notas: values.notas ?? "",
            }),
          )}
        >
          <input type="hidden" {...register("pacienteId")} />
          <input type="hidden" {...register("duracion", { valueAsNumber: true })} />
          <input type="hidden" {...register("modalidad")} />

          <div className="flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
            <div className="space-y-5">
              <div className="relative">
                <div onBlur={handleSearchBlur}>
                  <Input
                    label="Paciente"
                    placeholder="Buscar o crear nuevo…"
                    value={searchTerm}
                    error={patientFieldError}
                    aria-autocomplete="list"
                    aria-controls={patientListId}
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-activedescendant={
                      open && hasOptions ? `${patientListId}-option-${effectiveActiveIndex}` : undefined
                    }
                    className="pr-10"
                    onFocus={handleSearchFocus}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>

                {open && (
                  <div
                    role="listbox"
                    id={patientListId}
                    className="absolute left-0 right-0 top-full z-10 mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-[color:var(--border-subtle)] bg-white shadow-raised"
                    onMouseDown={() => {
                      if (closeTimerRef.current !== null) {
                        window.clearTimeout(closeTimerRef.current);
                        closeTimerRef.current = null;
                      }
                    }}
                  >
                    {filteredPacientes.map((paciente, index) => {
                      const active = index === effectiveActiveIndex;
                      const tone = avatarColor(fullName(paciente));

                      return (
                        <button
                          key={paciente.id}
                          id={`${patientListId}-option-${index}`}
                          type="button"
                          role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectPaciente(paciente)}
                          className={`flex w-full items-center gap-3 px-[14px] py-[10px] text-left transition-colors duration-150 ${
                            active ? "bg-cream-50" : "bg-white hover:bg-cream-50"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[12px] font-medium leading-none"
                            style={{
                              backgroundColor: tone.bg,
                              color: tone.fg,
                            }}
                          >
                            {initials(paciente.nombre, paciente.apellido)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-ink-900">
                              {fullName(paciente)}
                            </span>
                            <span className="block text-[12px] text-ink-500">
                              {money(paciente.tarifa)}
                            </span>
                          </span>
                        </button>
                      );
                    })}

                    {canCreatePaciente && (
                      <button
                        id={`${patientListId}-option-${optionCount - 1}`}
                        type="button"
                        role="option"
                        aria-selected={effectiveActiveIndex === optionCount - 1}
                        onMouseEnter={() => setActiveIndex(optionCount - 1)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setValue("pacienteId", "", {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-[14px] py-[10px] text-left transition-colors duration-150 ${
                          effectiveActiveIndex === optionCount - 1
                            ? "bg-cream-50"
                            : "bg-white hover:bg-cream-50"
                        }`}
                      >
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-50 text-[14px] font-semibold leading-none text-sage-600">
                          <Plus size={14} strokeWidth={2.5} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink-900">
                            Crear paciente {trimmedSearch}
                          </span>
                          <span className="block text-[12px] text-ink-500">
                            Se podrá completar después
                          </span>
                        </span>
                      </button>
                    )}

                    {!hasOptions && !canCreatePaciente && (
                      <div className="px-[14px] py-[12px] text-[13px] text-ink-500">
                        No hay pacientes para mostrar.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Fecha"
                  type="date"
                  error={fechaError}
                  {...register("fecha")}
                />
                <Input
                  label="Hora"
                  type="time"
                  error={horaError}
                  {...register("hora")}
                />
              </div>

              <div className="space-y-2">
                <label className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Duración
                </label>
                <div className="flex gap-2">
                  {duraciones.map((opcion) => {
                    const active = duracion === opcion;

                    return (
                      <Button
                        key={opcion}
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-pressed={active}
                        onClick={() =>
                          setValue("duracion", opcion, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className={`flex-1 !px-0 border ${
                          active
                            ? "!border-sage-500 !bg-sage-500 !text-white hover:!bg-sage-500"
                            : "!border-[color:var(--border-subtle)] !bg-cream-50 !text-ink-700 hover:!bg-cream-100"
                        }`}
                      >
                        {opcion}′
                      </Button>
                    );
                  })}
                </div>
                {duracionError && (
                  <p className="text-[12px] text-[color:var(--color-error)]">{duracionError}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Modalidad
                </label>
                <Segmented
                  ariaLabel="Modalidad"
                  value={modalidad}
                  onChange={(value) =>
                    setValue("modalidad", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  options={[
                    { value: "presencial", label: "Presencial" },
                    { value: "online", label: "Online" },
                  ]}
                />
                {modalidadError && (
                  <p className="text-[12px] text-[color:var(--color-error)]">
                    {modalidadError}
                  </p>
                )}
              </div>

              <Textarea
                label="Notas (opcional)"
                placeholder="Algo para recordar del turno."
                error={errors.notas?.message}
                className="min-h-[72px]"
                {...register("notas")}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-[color:var(--border-subtle)] px-6 pb-6 pt-4 md:px-8 md:pb-6 md:pt-[18px]">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                Agendar
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
