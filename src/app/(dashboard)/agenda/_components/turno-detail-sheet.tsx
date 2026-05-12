"use client";

import * as React from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, LoaderCircle, Mic } from "lucide-react";
import {
  Avatar,
  Button,
  Chip,
  Input,
  Segmented,
  Sheet,
  Textarea,
} from "@/components/ui";
import { GrabadorSesion } from "@/components/grabacion/GrabadorSesion";
import { NotaClinicaView } from "@/components/grabacion/NotaClinicaView";
import { useSesionClinicaPolling } from "@/hooks/useSesionClinicaPolling";
import { fechaLarga, hora, money } from "@/lib/format";
import type {
  DatosEstructurados,
  Duracion,
  EstadoProcesamiento,
  MetodoPago,
  Modalidad,
  NotaSOAP,
  SesionClinicaResponse,
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

// Forma cruda devuelta por la API de sesion-clinica (mapea 1:1 con el modelo Prisma).
type RawSesionClinica = {
  id: string;
  turnoId: string;
  estado: string;
  duracionAudioSeg: number | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  // Post-extensión Prisma: la columna cifrada se deserializa a objeto.
  // Se sigue aceptando string para compatibilidad con filas legacy/sin migrar.
  datosEstructurados: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
};

function parseDatosEstructurados(
  value: DatosEstructurados | string | null,
): DatosEstructurados | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DatosEstructurados;
    } catch {
      return null;
    }
  }
  return value;
}

function toSesionClinicaResponse(raw: RawSesionClinica): SesionClinicaResponse {
  const nota: NotaSOAP | null =
    raw.notaSubjetivo !== null &&
    raw.notaObjetivo !== null &&
    raw.notaAnalisis !== null &&
    raw.notaPlan !== null
      ? {
          subjetivo: raw.notaSubjetivo,
          objetivo: raw.notaObjetivo,
          analisis: raw.notaAnalisis,
          plan: raw.notaPlan,
        }
      : null;

  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado as EstadoProcesamiento,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota,
    datosEstructurados: parseDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
  };
}

function chipDeProcesamiento(estado: EstadoProcesamiento): {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
} {
  switch (estado) {
    case "grabando":
      return { variant: "terracotta", label: "Grabando…" };
    case "subiendo":
      return { variant: "gold", label: "Subiendo audio…" };
    case "procesando":
      return { variant: "gold", label: "Procesando con IA…" };
    case "revision":
      return { variant: "sage", label: "Lista para revisar" };
    case "aprobado":
      return { variant: "sage", label: "Nota clínica aprobada ✓" };
    case "error":
      return { variant: "terracotta", label: "Error en el procesamiento" };
    default:
      return { variant: "neutral", label: "Pendiente" };
  }
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

  // Sesión clínica (grabación + nota generada por IA)
  const [sesionClinica, setSesionClinica] =
    React.useState<SesionClinicaResponse | null>(null);
  const [consentimientoVigente, setConsentimientoVigente] =
    React.useState<boolean | null>(null);
  const [seccionGrabacion, setSeccionGrabacion] =
    React.useState<"idle" | "grabando" | "nota">("idle");
  const [grabacionError, setGrabacionError] = React.useState<string | null>(null);
  const [grabacionSubmitting, setGrabacionSubmitting] = React.useState(false);

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

  // Carga consentimiento + sesión clínica cuando el turno está realizado.
  // Resetea el estado al cambiar de turno.
  const turnoId = turno?.id;
  const turnoEstado = turno?.estado;
  const turnoPacienteId = turno?.pacienteId;

  React.useEffect(() => {
    setSesionClinica(null);
    setConsentimientoVigente(null);
    setSeccionGrabacion("idle");
    setGrabacionError(null);

    if (!turnoId || turnoEstado !== "realizado" && turnoEstado !== "programado" || !turnoPacienteId) {
      return;
    }

    let cancelado = false;

    async function cargar() {
      try {
        const consentRes = await fetch(
          `/api/pacientes/${turnoPacienteId}/consentimiento`,
        );
        if (cancelado) return;
        if (consentRes.ok) {
          const body = (await consentRes.json()) as { consentimiento: unknown };
          setConsentimientoVigente(body.consentimiento !== null);
        } else {
          setConsentimientoVigente(false);
        }
      } catch {
        if (!cancelado) setConsentimientoVigente(false);
      }

      // TODO: depende de un endpoint GET /api/sesion-clinica?turnoId=... que aún
      // no existe. Mientras tanto un 404/405 se interpreta como "no hay sesión
      // clínica todavía" y la sección arranca en el estado inicial.
      try {
        const sesionRes = await fetch(
          `/api/sesion-clinica?turnoId=${turnoId}`,
        );
        if (cancelado) return;
        if (sesionRes.ok) {
          const body = (await sesionRes.json()) as {
            data: RawSesionClinica | null;
          };
          if (body.data) {
            setSesionClinica(toSesionClinicaResponse(body.data));
          }
        }
      } catch {
        // sin sesión clínica accesible — se mantiene null
      }
    }

    void cargar();

    return () => {
      cancelado = true;
    };
  }, [turnoId, turnoEstado, turnoPacienteId]);

  // Polling automático mientras la sesión está siendo procesada por el pipeline.
  // El hook hace fetch cada 10s; cuando estado pasa a revision/aprobado/error,
  // deja de pollear y la última lectura ya trae el cambio.
  const sesionEnProcesamiento =
    sesionClinica !== null &&
    (sesionClinica.estado === "grabando" ||
      sesionClinica.estado === "subiendo" ||
      sesionClinica.estado === "procesando");

  const { data: sesionPolled } = useSesionClinicaPolling({
    sesionClinicaId: sesionEnProcesamiento ? sesionClinica?.id ?? null : null,
    enabled: sesionEnProcesamiento,
  });

  React.useEffect(() => {
    if (sesionPolled) {
      setSesionClinica(sesionPolled);
    }
  }, [sesionPolled]);

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
  const esRealizado = turno.estado === "realizado";
  const esRealizadoPorCobrar =
    turno.estado === "realizado" && turno.pagoEstado === "pendiente";

  const pacienteNombreCompleto = `${turno.paciente.nombre} ${turno.paciente.apellido}`;

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

  async function patchSesionClinica(payload: Record<string, unknown>) {
    if (!sesionClinica) return null;
    const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await parseError(res));
    const body = (await res.json()) as { data: RawSesionClinica };
    const next = toSesionClinicaResponse(body.data);
    setSesionClinica(next);
    return next;
  }

  async function iniciarGrabacionFlow() {
    if (!turno) return;
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      const createRes = await fetch("/api/sesion-clinica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId: turno.id }),
      });
      if (!createRes.ok) throw new Error(await parseError(createRes));
      const createBody = (await createRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(createBody.data));

      // pendiente → grabando
      const patchRes = await fetch(
        `/api/sesion-clinica/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "grabando" }),
        },
      );
      if (!patchRes.ok) throw new Error(await parseError(patchRes));
      const patchBody = (await patchRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(patchBody.data));
      setSeccionGrabacion("grabando");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo iniciar la grabación";
      setGrabacionError(message);
      onError(message);
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  async function manejarGrabacionCompleta(datos: {
    audioBlob: Blob;
    claveCifrado: string;
    ivCifrado: string;
    duracionSegundos: number;
  }) {
    if (!sesionClinica || !turno) return;
    const sesionId = sesionClinica.id;
    const turnoIdLocal = turno.id;
    const eraProgramado = turno.estado === "programado";
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      // No patcheamos "subiendo" antes del upload: el endpoint
      // /api/sesion-clinica/{id}/upload acepta entrada desde "grabando" y, en
      // la misma transacción, persiste `duracionAudioSeg` + estado "procesando"
      // (via db.update directo, sin pasar por el state machine). Patchear
      // "subiendo" antes era una llamada HTTP extra que no aportaba nada al
      // flujo y que, combinada con el PATCH "procesando" post-upload que ya
      // habíamos removido, era la causa del error "Transición inválida:
      // procesando → procesando".
      const formData = new FormData();
      formData.append("audio", datos.audioBlob, "sesion.bin");
      formData.append("claveCifrado", datos.claveCifrado);
      formData.append("iv", datos.ivCifrado);
      formData.append("duracionSegundos", String(datos.duracionSegundos));

      const uploadRes = await fetch(
        `/api/sesion-clinica/${sesionId}/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      if (!uploadRes.ok) throw new Error(await parseError(uploadRes));

      // Auto-transición del turno cuando se grabó durante uno programado:
      // grabar y subir el audio sin errores implica que la sesión ocurrió,
      // así que cerramos el turno sin pedir un tap extra al usuario. Si el
      // PATCH falla no rompemos el flujo (el audio ya está subido y procesando);
      // la psicóloga puede marcar manualmente desde el sheet si hace falta.
      if (eraProgramado) {
        try {
          const turnoRes = await fetch(`/api/turnos/${turnoIdLocal}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: "realizado" }),
          });
          if (turnoRes.ok) {
            // onUpdated cierra el sheet y refresca la agenda — el siguiente
            // open va a mostrar el turno como realizado con la sesión clínica
            // en "procesando". Salimos antes de tocar seccionGrabacion.
            onUpdated("Sesión grabada · turno marcado como realizado");
            return;
          }
          console.warn(
            "No se pudo marcar el turno como realizado tras grabar:",
            await parseError(turnoRes),
          );
        } catch (turnoErr) {
          console.warn(
            "Error PATCH del turno post-grabación:",
            turnoErr,
          );
        }
      }

      setSeccionGrabacion("idle");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al subir el audio";
      setGrabacionError(message);
      onError(message);
      // Best-effort: marcar como error. La transición puede ser rechazada por
      // la state machine según en qué paso falló — se ignora silenciosamente.
      try {
        await fetch(`/api/sesion-clinica/${sesionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "error" }),
        });
      } catch {
        // tragar
      }
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  async function reintentarProcesamiento() {
    if (!sesionClinica) return;
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      await patchSesionClinica({ estado: "procesando" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo reintentar";
      setGrabacionError(message);
      onError(message);
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  async function refrescarSesion() {
    if (!sesionClinica) return;
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(body.data));
      setSeccionGrabacion("idle");
    } catch {
      // tragar
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

            <Link
              href={`/pacientes/${turno.paciente.id}`}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-sage-600 hover:text-sage-700"
            >
              Ver ficha del paciente
              <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </>
        )}

        {/* Estado cancelado */}
        {mode === "view" && esCancelado ? (
          <div className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
            Este turno fue cancelado.
          </div>
        ) : null}

        {/* Sesión clínica — turnos programados (grabar durante la sesión) o
            realizados (caso edge: ya ocurrió pero no se grabó en su momento).
            Va arriba de las acciones del turno para que "Grabar sesión" sea
            el CTA visualmente dominante en un turno programado; ese flujo es
            el que cierra el turno automáticamente al subir el audio. */}
        {mode === "view" && (esProgramado || esRealizado) ? (
          <div className="flex flex-col gap-3 border-t border-[color:var(--border-subtle)] pt-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Sesión clínica
            </div>

            {seccionGrabacion === "grabando" && sesionClinica ? (
              <GrabadorSesion
                turnoId={turno.id}
                pacienteNombre={pacienteNombreCompleto}
                onGrabacionCompleta={(datos) => {
                  void manejarGrabacionCompleta(datos);
                }}
                onError={(mensaje) => {
                  setGrabacionError(mensaje);
                  onError(mensaje);
                }}
              />
            ) : null}

            {seccionGrabacion === "nota" &&
            sesionClinica &&
            sesionClinica.nota ? (
              <NotaClinicaView
                sesionClinicaId={sesionClinica.id}
                nota={sesionClinica.nota}
                datosEstructurados={sesionClinica.datosEstructurados}
                pacienteNombre={pacienteNombreCompleto}
                fechaSesion={fechaLarga(turno.fecha)}
                onAprobado={() => {
                  void refrescarSesion();
                }}
              />
            ) : null}

            {seccionGrabacion === "idle" ? (
              <>
                {/* Mientras carga el estado del consentimiento + sesión */}
                {sesionClinica === null && consentimientoVigente === null ? (
                  <p className="text-[13px] text-ink-500">Cargando…</p>
                ) : null}

                {/* Caso A — sin sesión, con consentimiento vigente.
                    Variant primaria: para un turno programado este es el CTA
                    principal del sheet; para un realizado-sin-sesión también
                    es la próxima acción significativa. */}
                {sesionClinica === null && consentimientoVigente === true ? (
                  <Button
                    icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}
                    onClick={() => {
                      void iniciarGrabacionFlow();
                    }}
                    disabled={grabacionSubmitting}
                  >
                    Grabar sesión
                  </Button>
                ) : null}

                {/* Caso B — sin sesión, sin consentimiento */}
                {sesionClinica === null && consentimientoVigente === false ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] text-ink-500">
                      Para grabar sesiones, el paciente necesita autorizar la
                      grabación desde su perfil.
                    </p>
                    <Link
                      href={`/pacientes/${turno.paciente.id}`}
                      className="inline-flex items-center gap-1 text-[13px] font-semibold text-sage-600 hover:text-sage-700"
                    >
                      Ir al perfil
                      <ArrowRight size={14} strokeWidth={2} />
                    </Link>
                  </div>
                ) : null}

                {/* Caso C — grabando / subiendo / procesando */}
                {sesionClinica &&
                (sesionClinica.estado === "grabando" ||
                  sesionClinica.estado === "subiendo" ||
                  sesionClinica.estado === "procesando") ? (
                  <div className="flex items-center gap-3 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-3">
                    <LoaderCircle
                      size={16}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className="shrink-0 animate-spin text-sage-500"
                    />
                    <Chip
                      variant={chipDeProcesamiento(sesionClinica.estado).variant}
                      size="sm"
                    >
                      {chipDeProcesamiento(sesionClinica.estado).label}
                    </Chip>
                  </div>
                ) : null}

                {/* Caso D — revision: mostrar la nota para aprobar */}
                {sesionClinica &&
                sesionClinica.estado === "revision" &&
                sesionClinica.nota ? (
                  <NotaClinicaView
                    sesionClinicaId={sesionClinica.id}
                    nota={sesionClinica.nota}
                    datosEstructurados={sesionClinica.datosEstructurados}
                    pacienteNombre={pacienteNombreCompleto}
                    fechaSesion={fechaLarga(turno.fecha)}
                    onAprobado={() => {
                      void refrescarSesion();
                    }}
                  />
                ) : null}

                {/* Caso E — aprobado */}
                {sesionClinica && sesionClinica.estado === "aprobado" ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-sage-200 bg-sage-50 px-3 py-2">
                    <Chip variant="sage" size="sm">
                      Nota clínica aprobada ✓
                    </Chip>
                    {sesionClinica.nota ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSeccionGrabacion("nota")}
                      >
                        Ver nota
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {/* Caso F — error */}
                {sesionClinica && sesionClinica.estado === "error" ? (
                  <div className="flex flex-col gap-2 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3">
                    <Chip variant="terracotta" size="sm">
                      Error en el procesamiento
                    </Chip>
                    {sesionClinica.error ? (
                      <p className="text-[13px] text-ink-500">
                        {sesionClinica.error}
                      </p>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void reintentarProcesamiento();
                      }}
                      disabled={grabacionSubmitting}
                    >
                      Reintentar
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {grabacionError ? (
              <p className="text-[12px] text-[color:var(--color-error)]">
                {grabacionError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Acciones en modo view — "Marcar como realizado" queda como ruta
            alternativa de baja prominencia: el flujo principal para cerrar un
            turno programado es grabarlo (la grabación lo cierra al subir el
            audio). Este botón existe para sesiones que ya ocurrieron sin
            grabar. */}
        {mode === "view" && esProgramado ? (
          <div className="flex flex-col gap-2 border-t border-[color:var(--border-subtle)] pt-5">
            <Button
              variant="secondary"
              onClick={() =>
                patchTurno({ estado: "realizado" }, "Turno marcado como realizado")
              }
              disabled={submitting}
            >
              Marcar como realizado
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={openEditMode}
                disabled={submitting}
              >
                Editar turno
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
