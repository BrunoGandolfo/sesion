"use client";

import * as React from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import {
  Avatar,
  Button,
  Chip,
  Input,
  Segmented,
  Sheet,
  Textarea,
} from "@/components/ui";
import { fechaLarga, hora, money } from "@/lib/format";
import type {
  Duracion,
  MetodoPago,
  Modalidad,
  TurnoConPaciente,
} from "@/types/domain";

const DURACIONES: Duracion[] = [30, 45, 50, 60, 90];

// Mismos métodos que dashboard.tsx y paciente-detail-view.tsx.
const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

// Estados de sesión clínica que justifican cambiar el CTA al paciente por
// "Ver sesión clínica". El detalle/aprobación viven en el tab Historia.
const ESTADOS_SESION_ACTIVA = new Set(["grabando", "subiendo", "procesando", "revision"]);

const editSchema = z.object({
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

type EditValues = z.infer<typeof editSchema>;

type Mode = "view" | "edit" | "confirm-cancel";

interface Props {
  open: boolean;
  turno: TurnoConPaciente | null;
  onClose: () => void;
  onUpdated: (message: string) => void;
  onError: (message: string) => void;
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function statusChip(turno: TurnoConPaciente) {
  if (turno.estado === "cancelado")
    return { variant: "neutral" as const, label: "Cancelado" };
  if (turno.estado === "ausente")
    return { variant: "neutral" as const, label: "Ausente" };
  if (turno.estado === "realizado" && turno.pagoEstado === "pagado")
    return { variant: "sage" as const, label: "Pagado" };
  if (turno.estado === "realizado")
    return { variant: "terracotta" as const, label: "Por cobrar" };
  return { variant: "gold" as const, label: "Programado" };
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `HTTP ${res.status}`;
}

export function TurnoDetailSheet({
  open,
  turno,
  onClose,
  onUpdated,
  onError,
}: Props) {
  const [mode, setMode] = React.useState<Mode>("view");
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  // Cuando es true, en vez del botón "Cobrar" se muestra el selector de método.
  const [eligiendoMetodo, setEligiendoMetodo] = React.useState(false);
  // Solo se usa para decidir el label del CTA al paciente. Fetch único, sin polling.
  const [sesionActiva, setSesionActiva] = React.useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fecha: "",
      hora: "",
      duracion: 50,
      modalidad: "presencial",
      notas: "",
    },
    mode: "onSubmit",
  });

  const duracion = useWatch({ control, name: "duracion" });
  const modalidad = useWatch({ control, name: "modalidad" });

  const openEditMode = React.useCallback(() => {
    if (!turno) return;

    reset({
      fecha: toDateInput(turno.fecha),
      hora: toTimeInput(turno.fecha),
      duracion: turno.duracion,
      modalidad: turno.modalidad,
      notas: turno.notas ?? "",
    });
    setFormError(null);
    setMode("edit");
  }, [reset, turno]);

  const turnoId = turno?.id;
  const turnoEstado = turno?.estado;

  // No se resetea `sesionActiva` acá: el padre monta este sheet con
  // key={detalleId}, así que cada turno arranca con el estado inicial (false).
  React.useEffect(() => {
    if (!turnoId) return;
    if (turnoEstado !== "programado" && turnoEstado !== "realizado") return;

    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sesion-clinica?turnoId=${turnoId}`);
        if (cancelado || !res.ok) return;
        const body = (await res.json()) as { data: { estado?: string } | null };
        if (body.data && ESTADOS_SESION_ACTIVA.has(body.data.estado ?? "")) {
          setSesionActiva(true);
        }
      } catch {
        // sin info de sesión → mantenemos el CTA por defecto
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [turnoId, turnoEstado]);

  if (!turno) {
    return (
      <Sheet open={open} onClose={onClose} ariaLabel="Detalle del turno">
        <div className="py-10 text-center text-[14px] text-ink-500">
          Cargando turno…
        </div>
      </Sheet>
    );
  }

  const chip = statusChip(turno);
  const esProgramado = turno.estado === "programado";
  const esCancelado = turno.estado === "cancelado";
  const esAusente = turno.estado === "ausente";
  const esRealizadoPorCobrar =
    turno.estado === "realizado" && turno.pagoEstado === "pendiente";

  async function patchTurno(
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    if (!turno) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/turnos/${turno.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await parseError(res));
      onUpdated(successMessage);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Algo salió mal";
      setFormError(message);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function cobrar(metodo: MetodoPago) {
    if (!turno) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/turnos/${turno.id}/cobrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      setEligiendoMetodo(false);
      onUpdated("Cobro registrado");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Algo salió mal";
      setFormError(message);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const onSubmitEdit = handleSubmit((values) => {
    const fechaISO = new Date(
      `${values.fecha}T${values.hora}:00`,
    ).toISOString();
    const trimmed = values.notas?.trim() ?? "";
    patchTurno(
      {
        fecha: fechaISO,
        duracion: values.duracion,
        modalidad: values.modalidad,
        notas: trimmed === "" ? null : trimmed,
      },
      "Turno actualizado",
    );
  });

  const ctaPacienteLabel = sesionActiva ? "Ver sesión clínica" : "Ver paciente";

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Detalle del turno">
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar
            nombre={turno.paciente.nombre}
            apellido={turno.paciente.apellido}
            size={44}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-[family-name:var(--font-display)] text-[22px] font-medium tracking-[-0.01em] leading-tight text-ink-900">
              {turno.paciente.nombre} {turno.paciente.apellido}
            </h2>
            <div className="flex items-center gap-2">
              <Chip variant={chip.variant}>{chip.label}</Chip>
            </div>
          </div>
        </div>

        {/* Datos (view mode) */}
        {mode === "view" && (
          <>
            <dl className="grid grid-cols-2 gap-y-3 gap-x-4 border-t border-[color:var(--border-subtle)] pt-5">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Fecha
                </dt>
                <dd className="mt-1 text-[14px] text-ink-900">
                  {fechaLarga(turno.fecha)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Hora
                </dt>
                <dd className="mt-1 text-[14px] text-ink-900 tabular-nums">
                  {hora(turno.fecha)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Duración
                </dt>
                <dd className="mt-1 text-[14px] text-ink-900">
                  {turno.duracion} min
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Modalidad
                </dt>
                <dd className="mt-1 text-[14px] text-ink-900">
                  {turno.modalidad === "online" ? "Online" : "Presencial"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Tarifa
                </dt>
                <dd className="mt-1 text-[14px] text-ink-900 tabular-nums">
                  {money(turno.tarifaCobrada)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Estado
                </dt>
                <dd className="mt-1">
                  <Chip variant={chip.variant}>{chip.label}</Chip>
                </dd>
              </div>
            </dl>

            {turno.notas ? (
              <div className="border-t border-[color:var(--border-subtle)] pt-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Notas
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink-700">
                  {turno.notas}
                </p>
              </div>
            ) : null}

            <Button asChild variant="secondary" className="w-full">
              <Link href={`/pacientes/${turno.paciente.id}`}>
                {ctaPacienteLabel}
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </Button>
          </>
        )}

        {/* Banners terminales */}
        {mode === "view" && esCancelado ? (
          <div className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
            Este turno fue cancelado.
          </div>
        ) : null}

        {mode === "view" && esAusente ? (
          <div className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
            El paciente no se presentó a este turno.
          </div>
        ) : null}

        {/* Acciones — turno programado */}
        {mode === "view" && esProgramado ? (
          <div className="flex flex-col gap-2 border-t border-[color:var(--border-subtle)] pt-5">
            <Button
              onClick={() =>
                patchTurno({ estado: "realizado" }, "Turno marcado como realizado")
              }
              disabled={submitting}
            >
              Marcar como realizado
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                patchTurno({ estado: "ausente" }, "Turno marcado como ausente")
              }
              disabled={submitting}
            >
              Marcar como ausente
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={openEditMode}
                disabled={submitting}
              >
                Reprogramar
              </Button>
              <Button
                variant="secondary"
                className="flex-1 !border-terracotta-500 !text-terracotta-600 hover:!bg-terracotta-50"
                onClick={() => setMode("confirm-cancel")}
                disabled={submitting}
              >
                Cancelar turno
              </Button>
            </div>
          </div>
        ) : null}

        {/* Cobro — turno realizado pendiente de pago */}
        {mode === "view" && esRealizadoPorCobrar ? (
          <div className="border-t border-[color:var(--border-subtle)] pt-5">
            {!eligiendoMetodo ? (
              <Button
                className="w-full"
                onClick={() => {
                  setFormError(null);
                  setEligiendoMetodo(true);
                }}
                disabled={submitting}
              >
                Cobrar
              </Button>
            ) : (
              <div>
                <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Elegí el método de pago
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {METODOS_PAGO.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => cobrar(m.value)}
                      disabled={submitting}
                      className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-left text-[14px] font-semibold text-ink-900 transition-colors duration-150 hover:border-sage-500 hover:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEligiendoMetodo(false)}
                    disabled={submitting}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Confirmación cancelar */}
        {mode === "confirm-cancel" ? (
          <div className="rounded-md border border-terracotta-500/30 bg-terracotta-50 px-4 py-4">
            <p className="text-[14px] font-semibold text-terracotta-600">
              ¿Cancelar este turno?
            </p>
            <p className="mt-1 text-[13px] text-ink-700">
              Esta acción no se puede deshacer.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setMode("view")}
                disabled={submitting}
              >
                No, volver
              </Button>
              <Button
                className="flex-1 !bg-terracotta-500 hover:!bg-terracotta-600"
                onClick={() =>
                  patchTurno({ estado: "cancelado" }, "Turno cancelado")
                }
                disabled={submitting}
              >
                Sí, cancelar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Modo edición */}
        {mode === "edit" ? (
          <form onSubmit={onSubmitEdit} className="flex flex-col gap-4">
            <input
              type="hidden"
              {...register("duracion", { valueAsNumber: true })}
            />
            <input type="hidden" {...register("modalidad")} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Fecha"
                type="date"
                error={errors.fecha?.message}
                {...register("fecha")}
              />
              <Input
                label="Hora"
                type="time"
                error={errors.hora?.message}
                {...register("hora")}
              />
            </div>

            <div className="space-y-2">
              <label className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Duración
              </label>
              <div className="flex gap-2">
                {DURACIONES.map((opcion) => {
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
            </div>

            <div className="space-y-2">
              <label className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Modalidad
              </label>
              <Segmented
                ariaLabel="Modalidad"
                value={modalidad}
                onChange={(value: Modalidad) =>
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
            </div>

            <Textarea
              label="Notas"
              placeholder="Algo para recordar del turno."
              error={errors.notas?.message}
              className="min-h-[72px]"
              {...register("notas")}
            />

            {formError ? (
              <p className="text-[12px] text-[color:var(--color-error)]">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMode("view")}
                disabled={submitting}
              >
                Cancelar edición
              </Button>
              <Button type="submit" disabled={submitting}>
                Guardar cambios
              </Button>
            </div>
          </form>
        ) : null}

        {/* Error banner en modo view */}
        {mode === "view" && formError ? (
          <p className="text-[12px] text-[color:var(--color-error)]">
            {formError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
