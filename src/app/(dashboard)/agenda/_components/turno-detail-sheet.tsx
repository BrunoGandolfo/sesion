"use client";

// Sheet del turno: el brief corto arriba, los datos, y las acciones que
// tienen sentido para el estado en que está.
//
// Cobrar cierra el turno solo (caso de uso cobrar-turno): no existe más
// "Marcar como realizado". Lo destructivo ("No vino", "Cancelar") pasa por
// Confirmar. "Revisar nota" aparece cuando el turno ya tiene una sesión
// clínica; si no la tiene, "Grabar sesión".

import * as React from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Mic } from "lucide-react";

import {
  Avatar,
  Button,
  Chip,
  Confirmar,
  Input,
  Segmented,
  Sheet,
  Textarea,
} from "@/components/ui";
import { useHoy } from "@/hooks/useHoy";
import {
  fechaInputMvd,
  horaInputMvd,
  instanteDesdeFechaHoraMvd,
} from "@/lib/fechas-montevideo";
import {
  ApiClientError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  esAbort,
} from "@/lib/api-client";
import { fechaCorta, fechaLarga, hora, money } from "@/lib/format";
import {
  AGENDADO,
  ALGO_FALLO,
  CANCELADO,
  COBRO_DESHECHO,
  DESHACER_COBRO,
  DESHACER_COBRO_ACCION,
  DESHACER_COBRO_MENSAJE,
  DESHACER_COBRO_TITULO,
  DESHACIENDO_COBRO,
  GRABAR_SESION,
  METODOS_PAGO,
  NO_VINO,
  PAGADO,
  PENDIENTE,
  RECORDATORIO,
  RECORDATORIO_ESTADO,
  REINTENTANDO_RECORDATORIO,
  REINTENTAR_RECORDATORIO,
  REINTENTAR_RECORDATORIO_MENSAJE,
  REINTENTAR_RECORDATORIO_TITULO,
  REVISAR_NOTA,
} from "@/lib/glosario";
import type {
  Duracion,
  MetodoPago,
  Modalidad,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";

import { BriefCortoDePaciente as BriefCorto } from "@/components/clinico/brief-corto";

const DURACIONES: Duracion[] = [30, 45, 50, 60, 90];


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

type Modo =
  | "ver"
  | "reprogramar"
  | "cobrar"
  | "confirmar-no-vino"
  | "confirmar-cancelar"
  | "confirmar-reintento"
  | "confirmar-deshacer-cobro";

/** El recordatorio tal como viaja por la red: las fechas son ISO. */
type RecordatorioJson = {
  id: string;
  estado: string;
  programadoEn: string;
  enviadoEn: string | null;
  intentos: number;
  error: string | null;
};

interface Props {
  open: boolean;
  turno: TurnoConPaciente | null;
  onClose: () => void;
  onUpdated: (message: string) => void;
  onError: (message: string) => void;
}

// El mismo estado que muestra la fila de la agenda (session-row), con las
// mismas palabras: acá decía "Cobrado"/"Sin cobrar" y allá "Pagado"/
// "Pendiente". Es un turno solo y se llama de una sola manera.
function chipDe(turno: TurnoConPaciente) {
  if (turno.estado === "cancelado")
    return { variant: "neutral" as const, label: CANCELADO };
  if (turno.estado === "ausente")
    return { variant: "neutral" as const, label: NO_VINO };
  if (turno.pagoEstado === "pagado")
    return { variant: "sage" as const, label: PAGADO };
  if (turno.estado === "realizado")
    return { variant: "terracotta" as const, label: PENDIENTE };
  return { variant: "gold" as const, label: AGENDADO };
}

function mensajeDe(err: unknown): string {
  return err instanceof ApiClientError ? err.mensaje : ALGO_FALLO;
}

type SesionDelTurno = { id: string; estado?: string } | null;

export function TurnoDetailSheet({
  open,
  turno,
  onClose,
  onUpdated,
  onError,
}: Props) {
  const [modo, setModo] = React.useState<Modo>("ver");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // null: todavía no se sabe; undefined nunca. El padre monta este sheet
  // con key={turnoId}, así que cada turno arranca de cero.
  const [sesion, setSesion] = React.useState<SesionDelTurno | "sin-dato">(
    "sin-dato",
  );
  // El recordatorio del turno. "sin-dato" mientras no contestó la API o
  // cuando no corresponde pedirlo; null si el turno no tiene ninguno.
  const [recordatorio, setRecordatorio] = React.useState<
    RecordatorioJson | null | "sin-dato"
  >("sin-dato");
  // Se incrementa después de reintentar: releer es más honesto que ajustar
  // la fila a mano y suponer en qué estado quedó.
  const [recordatorioKey, setRecordatorioKey] = React.useState(0);
  const hoy = useHoy();

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

  const turnoId = turno?.id;
  const turnoEstado = turno?.estado;

  React.useEffect(() => {
    if (!turnoId) return;
    if (turnoEstado !== "programado" && turnoEstado !== "realizado") return;

    const controller = new AbortController();
    apiGet<SesionDelTurno>(`/api/sesion-clinica?turnoId=${turnoId}`, {
      signal: controller.signal,
    })
      .then((data) => setSesion(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        // Sin dato de sesión se ofrece grabar igual: la API lo valida.
        setSesion(null);
      });
    return () => controller.abort();
  }, [turnoId, turnoEstado]);

  // Sólo tiene sentido en un turno programado: en uno cancelado, ausente o
  // ya realizado el recordatorio no se manda ni se reintenta.
  React.useEffect(() => {
    if (!turnoId || turnoEstado !== "programado") return;

    const controller = new AbortController();
    apiGet<RecordatorioJson[]>(`/api/recordatorios?turnoId=${turnoId}`, {
      signal: controller.signal,
    })
      .then((lista) => setRecordatorio(lista[0] ?? null))
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        // Sin dato no se dibuja el bloque: el turno se sigue pudiendo
        // manejar igual.
        setRecordatorio(null);
      });
    return () => controller.abort();
  }, [turnoId, turnoEstado, recordatorioKey]);

  const abrirReprogramar = () => {
    if (!turno) return;
    reset({
      fecha: fechaInputMvd(turno.fecha),
      hora: horaInputMvd(turno.fecha),
      duracion: turno.duracion,
      modalidad: turno.modalidad,
      notas: turno.notas ?? "",
    });
    setError(null);
    setModo("reprogramar");
  };

  if (!turno) {
    return (
      <Sheet open={open} onClose={onClose} ariaLabel="Detalle del turno">
        <p className="py-10 text-center text-[14px] text-ink-500">Cargando…</p>
      </Sheet>
    );
  }

  const chip = chipDe(turno);
  const esProgramado = turno.estado === "programado";
  const esRealizado = turno.estado === "realizado";
  const esCancelado = turno.estado === "cancelado";
  const esAusente = turno.estado === "ausente";
  const sinCobrar = turno.pagoEstado === "pendiente";
  const puedeCobrar = (esProgramado || esRealizado) && sinCobrar;
  // Se puede deshacer mientras el turno siga cobrado. Es una reversión: el
  // turno vuelve a quedar sin cobrar y se puede volver a cobrar.
  const puedeDeshacerCobro = turno.pagoEstado === "pagado";
  const puedeGrabarORevisar = esProgramado || esRealizado;
  const sesionId = sesion !== "sin-dato" && sesion ? sesion.id : null;
  const aviso = recordatorio !== "sin-dato" ? recordatorio : null;
  // El reintento sólo existe si el envío falló y el turno todavía no pasó:
  // las mismas tres condiciones que valida POST /reintentar, para no ofrecer
  // un botón que la API va a rechazar.
  const puedeReintentarAviso =
    aviso !== null &&
    aviso.estado === "fallido" &&
    esProgramado &&
    // `hoy` viene de useHoy: null en el render del servidor (y por eso el
    // botón no aparece hasta hidratar) y un Date estable después. Un
    // `Date.now()` acá sería una llamada impura en render.
    hoy !== null &&
    turno.fecha.getTime() > hoy.getTime();

  async function patchTurno(payload: Record<string, unknown>, mensaje: string) {
    if (!turno) return;
    setEnviando(true);
    setError(null);
    try {
      await apiPatch<Turno>(`/api/turnos/${turno.id}`, payload);
      onUpdated(mensaje);
    } catch (err) {
      const m = mensajeDe(err);
      setError(m);
      onError(m);
      setModo("ver");
    } finally {
      setEnviando(false);
    }
  }

  async function cobrar(metodo: MetodoPago) {
    if (!turno) return;
    setEnviando(true);
    setError(null);
    try {
      await apiPost<Turno>(`/api/turnos/${turno.id}/cobrar`, { metodo });
      onUpdated("Cobro registrado");
    } catch (err) {
      const m = mensajeDe(err);
      setError(m);
      onError(m);
      setModo("ver");
    } finally {
      setEnviando(false);
    }
  }

  async function deshacerCobro() {
    if (!turno) return;
    setEnviando(true);
    setError(null);
    try {
      await apiDelete<Turno>(`/api/turnos/${turno.id}/cobrar`);
      onUpdated(COBRO_DESHECHO);
    } catch (err) {
      const m = mensajeDe(err);
      setError(m);
      onError(m);
      setModo("ver");
    } finally {
      setEnviando(false);
    }
  }

  async function reintentarRecordatorio() {
    if (!aviso) return;
    setEnviando(true);
    setError(null);
    try {
      await apiPost(`/api/recordatorios/${aviso.id}/reintentar`, {});
      setModo("ver");
      // Se relee en vez de suponer: la fila la termina de mover el cron.
      setRecordatorioKey((k) => k + 1);
      onUpdated("Recordatorio en cola");
    } catch (err) {
      const m = mensajeDe(err);
      setError(m);
      onError(m);
      setModo("ver");
      setRecordatorioKey((k) => k + 1);
    } finally {
      setEnviando(false);
    }
  }

  const guardarReprogramacion = handleSubmit((values) => {
    // La hora que ella escribe es la del consultorio, no la del aparato desde
    // el que escribe: el turno de las 15:15 es a las 15:15 en Montevideo.
    const fechaISO = instanteDesdeFechaHoraMvd(
      values.fecha,
      values.hora,
    ).toISOString();
    const notas = values.notas?.trim() ?? "";
    void patchTurno(
      {
        fecha: fechaISO,
        duracion: values.duracion,
        modalidad: values.modalidad,
        notas: notas === "" ? null : notas,
      },
      "Turno reprogramado",
    );
  });

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Detalle del turno">
      <div className="flex flex-col gap-5">
        {/* Encabezado */}
        <div className="flex items-start gap-3">
          <Avatar
            nombre={turno.paciente.nombre}
            apellido={turno.paciente.apellido}
            size={44}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
              {turno.paciente.nombre} {turno.paciente.apellido}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
              <Chip variant={chip.variant}>{chip.label}</Chip>
              <span className="tabular-nums">
                {fechaLarga(turno.fecha)} · {hora(turno.fecha)}
              </span>
            </div>
          </div>
        </div>

        {/* Brief corto, arriba de todo lo demás */}
        {puedeGrabarORevisar ? <BriefCorto pacienteId={turno.paciente.id} /> : null}

        {modo === "ver" ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[color:var(--border-subtle)] pt-4">
              <Dato etiqueta="Duración">{turno.duracion} min</Dato>
              <Dato etiqueta="Modalidad">
                {turno.modalidad === "online" ? "Online" : "Presencial"}
              </Dato>
              <Dato etiqueta="Tarifa">
                <span className="tabular-nums">{money(turno.tarifaCobrada)}</span>
              </Dato>
              <Dato etiqueta="Pago">
                {turno.pagoEstado === "pagado"
                  ? `Cobrado${turno.pagoFecha ? ` el ${fechaCorta(turno.pagoFecha)}` : ""}`
                  : "Sin cobrar"}
              </Dato>
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

            {aviso ? (
              <div className="border-t border-[color:var(--border-subtle)] pt-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  {RECORDATORIO}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[14px] ${
                      aviso.estado === "fallido"
                        ? "text-terracotta-600"
                        : "text-ink-900"
                    }`}
                  >
                    {RECORDATORIO_ESTADO[aviso.estado] ?? aviso.estado}
                  </span>
                  <span className="text-[13px] tabular-nums text-ink-500">
                    ·{" "}
                    {aviso.enviadoEn
                      ? `${fechaCorta(new Date(aviso.enviadoEn))} ${hora(new Date(aviso.enviadoEn))}`
                      : `${fechaCorta(new Date(aviso.programadoEn))} ${hora(new Date(aviso.programadoEn))}`}
                  </span>
                </div>
                {puedeReintentarAviso ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setError(null);
                      setModo("confirmar-reintento");
                    }}
                    disabled={enviando}
                  >
                    {REINTENTAR_RECORDATORIO}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {esCancelado ? (
              <p className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
                Este turno fue cancelado.
              </p>
            ) : null}

            {esAusente ? (
              <p className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
                La paciente no vino a este turno.
              </p>
            ) : null}

            {/* Acciones */}
            {puedeGrabarORevisar ? (
              <div className="flex flex-col gap-2 border-t border-[color:var(--border-subtle)] pt-5">
                {puedeCobrar ? (
                  <Button
                    onClick={() => {
                      setError(null);
                      setModo("cobrar");
                    }}
                    disabled={enviando}
                  >
                    Cobrar
                  </Button>
                ) : null}

                {puedeDeshacerCobro ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      setModo("confirmar-deshacer-cobro");
                    }}
                    disabled={enviando}
                  >
                    {DESHACER_COBRO}
                  </Button>
                ) : null}

                {sesionId ? (
                  <Button asChild variant="secondary">
                    <Link href={`/sesiones/${sesionId}`}>
                      {REVISAR_NOTA}
                      <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="secondary">
                    <Link href={`/grabar/${turno.id}`}>
                      <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
                      {GRABAR_SESION}
                    </Link>
                  </Button>
                )}

                {esProgramado ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={abrirReprogramar}
                        disabled={enviando}
                      >
                        Reprogramar
                      </Button>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => {
                          setError(null);
                          setModo("confirmar-no-vino");
                        }}
                        disabled={enviando}
                      >
                        {NO_VINO}
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      className="!text-terracotta-600 hover:!bg-terracotta-50"
                      onClick={() => {
                        setError(null);
                        setModo("confirmar-cancelar");
                      }}
                      disabled={enviando}
                    >
                      Cancelar turno
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
                {error}
              </p>
            ) : null}
          </>
        ) : null}

        {/* Cobrar: elegir método */}
        {modo === "cobrar" ? (
          <div className="border-t border-[color:var(--border-subtle)] pt-5">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              ¿Cómo pagó?
            </p>
            <p className="mt-1 text-[13px] text-ink-700">
              {money(turno.tarifaCobrada)}
              {esProgramado ? " · al cobrar, el turno queda como realizado." : ""}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {METODOS_PAGO.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => void cobrar(m.value)}
                  disabled={enviando}
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
                onClick={() => setModo("ver")}
                disabled={enviando}
              >
                Volver
              </Button>
            </div>
          </div>
        ) : null}

        {modo === "confirmar-no-vino" ? (
          <Confirmar
            titulo={`¿${turno.paciente.nombre} no vino?`}
            mensaje="El turno queda registrado como ausencia. No se cobra y no se puede grabar."
            accion="Marcar que no vino"
            enviando={enviando}
            enviandoLabel="Guardando…"
            onConfirmar={() =>
              void patchTurno({ estado: "ausente" }, "Turno marcado: no vino")
            }
            onCancelar={() => setModo("ver")}
          />
        ) : null}

        {modo === "confirmar-cancelar" ? (
          <Confirmar
            titulo="¿Cancelar este turno?"
            mensaje="Se cancela el recordatorio por SMS. El turno queda en la ficha como cancelado y no se puede reabrir."
            accion="Cancelar el turno"
            cancelar="Volver"
            variante="peligro"
            enviando={enviando}
            enviandoLabel="Cancelando…"
            onConfirmar={() =>
              void patchTurno({ estado: "cancelado" }, "Turno cancelado")
            }
            onCancelar={() => setModo("ver")}
          />
        ) : null}

        {modo === "confirmar-deshacer-cobro" ? (
          <Confirmar
            titulo={DESHACER_COBRO_TITULO}
            mensaje={DESHACER_COBRO_MENSAJE}
            accion={DESHACER_COBRO_ACCION}
            cancelar="Volver"
            enviando={enviando}
            enviandoLabel={DESHACIENDO_COBRO}
            onConfirmar={() => void deshacerCobro()}
            onCancelar={() => setModo("ver")}
          />
        ) : null}

        {modo === "confirmar-reintento" ? (
          <Confirmar
            titulo={REINTENTAR_RECORDATORIO_TITULO}
            mensaje={REINTENTAR_RECORDATORIO_MENSAJE}
            accion={REINTENTAR_RECORDATORIO}
            enviando={enviando}
            enviandoLabel={REINTENTANDO_RECORDATORIO}
            onConfirmar={() => void reintentarRecordatorio()}
            onCancelar={() => setModo("ver")}
          />
        ) : null}

        {/* Reprogramar */}
        {modo === "reprogramar" ? (
          <form onSubmit={guardarReprogramacion} className="flex flex-col gap-4">
            <input type="hidden" {...register("duracion", { valueAsNumber: true })} />
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

            {error ? (
              <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setModo("ver")}
                disabled={enviando}
              >
                Volver
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Sheet>
  );
}

function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {etiqueta}
      </dt>
      <dd className="mt-1 text-[14px] text-ink-900">{children}</dd>
    </div>
  );
}
