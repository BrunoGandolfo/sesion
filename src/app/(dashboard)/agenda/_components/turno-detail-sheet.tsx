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
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Mic } from "lucide-react";

import { Avatar, Button, Chip, Confirmar, Sheet } from "@/components/ui";
import {
  CAMPOS_TURNO_DEFAULT,
  TurnoEditarCampos,
  camposTurnoSchema,
  type CamposTurnoValores,
} from "@/components/forms/turno-editar-campos";
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
import { CANCELAR_SERIE, CANCELAR_SERIE_TITULO, CANCELAR_SERIE_MENSAJE, CANCELAR_SERIE_ACCION, SERIE_CANCELADA,
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
  NOTA_PROCESANDO,
  GRABACION_SIN_TERMINAR,
  RECORDATORIO,
} from "@/lib/glosario";
import type { MetodoPago, Turno, TurnoConPaciente } from "@/types/domain";

import { BriefCortoDePaciente as BriefCorto } from "@/components/clinico/brief-corto";
import { estadoClinicoDe } from "@/components/ui/session-row";
import { esGrabacionSinTerminar } from "@/lib/sesion-clinica/estados";

// Los campos de "Reprogramar" son los del alta (fecha, hora, duración,
// modalidad, notas): mismo schema y mismo componente, turno-editar-campos.
type EditValues = CamposTurnoValores;

// Textos de pantalla que todavía no se mudaron a glosario.ts.






type Modo =
  | "ver"
  | "reprogramar"
  | "cobrar"
  | "confirmar-no-vino"
  | "confirmar-cancelar"
  | "confirmar-cancelar-serie"
  | "confirmar-deshacer-cobro";

/** El recordatorio tal como viaja por la red: las fechas son ISO. */
type RecordatorioJson = {
  id: string;
  estado: string;
  programadoEn: string;
  aceptadoEn: string | null;
  intentos: number;
  motivoNoEnvio: string | null;
};

interface Props {
  open: boolean;
  turno: TurnoConPaciente | null;
  onClose: () => void;
  onUpdated: (message: string) => void;
  /**
   * El cobro entró. Lo avisa aparte de `onUpdated` para que la pantalla
   * pueda dejarle la marca a la fila que lo originó mientras este sheet se
   * va (D9). El mensaje del toast no alcanza para reconocerlo: sería
   * comparar un string de copy.
   */
  onCobrado?: (turnoId: string) => void;
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

type SesionDelTurno = { id: string; estado?: string; actualizadaEn?: string } | null;

export function TurnoDetailSheet({
  open,
  turno,
  onClose,
  onUpdated,
  onCobrado,
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

  const metodos = useForm<EditValues>({
    resolver: zodResolver(camposTurnoSchema),
    defaultValues: CAMPOS_TURNO_DEFAULT,
    mode: "onSubmit",
  });
  const { handleSubmit, reset } = metodos;

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
  // ya realizado no se programa otro recordatorio.
  React.useEffect(() => {
    if (!turnoId || turnoEstado !== "programado") return;

    const controller = new AbortController();
    apiGet<RecordatorioJson[]>(`/api/sms/envios?turnoId=${turnoId}`, {
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
  }, [turnoId, turnoEstado]);

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
  // El estado clínico, con las mismas palabras que la fila de Hoy y de
  // Agenda (estadoClinicoDe): "Nota fallida · Ver qué pasó", "Para revisar",
  // "Nota lista". Antes cualquier sesión, fallida incluida, ofrecía "Revisar
  // nota", y una nota que no se pudo escribir parecía una nota para leer.
  const sesionDatos = sesion !== "sin-dato" ? sesion : null;
  const notaClinica = estadoClinicoDe(sesionDatos);
  // Una subida o una grabación que quedó a medias no se está procesando
  // (la regla y sus umbrales: esGrabacionSinTerminar, estados.ts).
  const sinTerminar = esGrabacionSinTerminar(sesionDatos, new Date());
  const notaEnProceso =
    !sinTerminar &&
    (sesionDatos?.estado === "procesando" || sesionDatos?.estado === "subiendo");
  const aviso = recordatorio !== "sin-dato" ? recordatorio : null;

  /**
   * Lo que rodea a las cuatro acciones del detalle: bloquear los botones,
   * borrar el error anterior y, si el pedido falla, dejar TODO como estaba.
   *
   * Quedarse en el modo en que estaba no es un detalle: antes, un 409 por
   * choque de horario devolvía a "ver", y al volver a "Reprogramar" el
   * formulario se recargaba con los valores del turno. O sea que el rechazo
   * le borraba justo la hora que tenía que corregir. Y el mensaje salía dos
   * veces —en línea y como toast—; ahora sale una sola, acá abajo.
   */
  async function ejecutar(
    pedido: (actual: TurnoConPaciente) => Promise<void>,
  ) {
    if (!turno) return;
    setEnviando(true);
    setError(null);
    try {
      await pedido(turno);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  function patchTurno(payload: Record<string, unknown>, mensaje: string) {
    return ejecutar(async (actual) => {
      await apiPatch<Turno>(`/api/turnos/${actual.id}`, payload);
      onUpdated(mensaje);
    });
  }

  // Cancela este turno y los siguientes de su serie que sigan programados
  // (casos-uso/cancelar-serie-turno.ts). Los realizados y los anteriores no
  // se tocan; cancelar UNO solo sigue siendo "Cancelar turno".
  function cancelarRestoDeSerie() {
    return ejecutar(async (actual) => {
      const resultado = await apiPost<{ cancelados: number }>(
        `/api/turnos/${actual.id}/cancelar-serie`,
        {},
      );
      onUpdated(SERIE_CANCELADA(resultado.cancelados));
    });
  }

  function cobrar(metodo: MetodoPago) {
    return ejecutar(async (actual) => {
      await apiPost<Turno>(`/api/turnos/${actual.id}/cobrar`, { metodo });
      // Primero la marca en la fila, después el cierre: el trazo empieza
      // mientras el sheet se va, no después.
      onCobrado?.(actual.id);
      onUpdated("Cobro registrado");
    });
  }

  function deshacerCobro() {
    return ejecutar(async (actual) => {
      await apiDelete<Turno>(`/api/turnos/${actual.id}/cobrar`, {
        actualizadoEn: actual.actualizadoEn,
      });
      onUpdated(COBRO_DESHECHO);
    });
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
                    {({pendiente:"Programado",enviando:"Enviando",aceptado:"En camino",entregado:"Entregado",no_entregado:"No llegó",cancelado:"Cancelado",fallido:"No salió",desconocido:"No sabemos si salió"} as Record<string,string>)[aviso.estado] ?? aviso.estado}
                  </span>
                  <span className="text-[13px] tabular-nums text-ink-500">
                    ·{" "}
                    {aviso.aceptadoEn
                      ? `${fechaCorta(new Date(aviso.aceptadoEn))} ${hora(new Date(aviso.aceptadoEn))}`
                      : `${fechaCorta(new Date(aviso.programadoEn))} ${hora(new Date(aviso.programadoEn))}`}
                  </span>
                </div>
                {aviso.motivoNoEnvio ? <p className="mt-2 text-[13px] text-ink-700">{aviso.motivoNoEnvio}</p> : null}
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

                {notaClinica ? (
                  <Button
                    asChild
                    variant="secondary"
                    className={notaClinica.fallida ? "!text-terracotta-600" : undefined}
                  >
                    <Link href={`/sesiones/${notaClinica.sesionId}`}>
                      {notaClinica.rotulo}
                      <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                    </Link>
                  </Button>
                ) : sinTerminar ? (
                  <Button asChild variant="secondary" className="!text-terracotta-600">
                    <Link href={`/grabar/${turno.id}`}>
                      {GRABACION_SIN_TERMINAR}
                      <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                    </Link>
                  </Button>
                ) : notaEnProceso ? (
                  <p className="text-[13px] text-ink-500" role="status">
                    {NOTA_PROCESANDO}
                  </p>
                ) : sesionDatos ? null : (
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
                    {turno.serieId ? (
                      <Button
                        variant="ghost"
                        className="!text-terracotta-600 hover:!bg-terracotta-50"
                        onClick={() => {
                          setError(null);
                          setModo("confirmar-cancelar-serie");
                        }}
                        disabled={enviando}
                      >
                        {CANCELAR_SERIE}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

          </>
        ) : null}

        {/* Cobrar: elegir método */}
        {modo === "cobrar" ? (
          <div className="border-t border-[color:var(--border-subtle)] pt-5">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              ¿Cómo pagó?
            </p>
            <p className="mt-1 tabular-nums text-[13px] text-ink-700">
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
                  className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-left text-[14px] font-semibold text-ink-900 transition-colors duration-[var(--duration-fast)] hover:border-sage-500 hover:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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

        {modo === "confirmar-cancelar-serie" ? (
          <Confirmar
            titulo={CANCELAR_SERIE_TITULO}
            mensaje={CANCELAR_SERIE_MENSAJE}
            accion={CANCELAR_SERIE_ACCION}
            cancelar="Volver"
            variante="peligro"
            enviando={enviando}
            enviandoLabel="Cancelando…"
            onConfirmar={() => void cancelarRestoDeSerie()}
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


        {/* Reprogramar */}
        {modo === "reprogramar" ? (
          <FormProvider {...metodos}>
          <form onSubmit={guardarReprogramacion} className="flex flex-col gap-4">
            <TurnoEditarCampos notasLabel="Notas" />

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
          </FormProvider>
        ) : null}

        {/* El error de cualquiera de las acciones, una sola vez y acá. */}
        {error ? (
          <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
            {error}
          </p>
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
