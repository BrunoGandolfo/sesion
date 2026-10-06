"use client";

// Sheet del turno: el brief corto arriba, los datos, y las acciones que
// tienen sentido para el estado en que está.
//
// Cobrar cierra el turno solo (caso de uso cobrar-turno): no existe más
// "Marcar como realizado". Lo destructivo ("No vino", "Cancelar") pasa por
// Confirmar. "Revisar nota" aparece cuando el turno ya tiene una sesión
// clínica; si no la tiene, "Grabar sesión".

import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { apiPatch, apiPost, esAbort, mensajeParaElla } from "@/lib/api-client";
import { fechaLarga, hora } from "@/lib/format";
import {
  CANCELAR_SERIE_TITULO,
  CANCELAR_SERIE_MENSAJE,
  CANCELAR_SERIE_ACCION,
  SERIE_CANCELADA,
  COBRADO,
  COBRO_DESHECHO,
  DESHACER_COBRO_ACCION,
  DESHACER_COBRO_MENSAJE,
  DESHACER_COBRO_TITULO,
  DESHACIENDO_COBRO,
  VOLVER,
  CARGANDO,
} from "@/lib/glosario";
import type { MetodoPago, Turno, TurnoConPaciente } from "@/types/domain";

import { BriefCortoDePaciente as BriefCorto } from "@/components/clinico/brief-corto";
import { SelectorMetodoPago } from "@/components/cobro/sheet-metodo-pago";
import { cobrarTurno, deshacerCobro } from "@/lib/cobrar-cliente";

import {
  accionesDelDetalle,
  chipDe,
  leerRecordatorio,
  leerSesion,
  type RecordatorioJson,
  type SesionDelTurno,
} from "./detalle-datos";
import { AccionesDelTurno, DatosDelTurno } from "./detalle-ver";

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
    leerSesion(turnoId, controller.signal)
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
    leerRecordatorio(turnoId, controller.signal)
      .then((data) => setRecordatorio(data))
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
        <p className="py-10 text-center text-[14px] text-ink-500">{CARGANDO}</p>
      </Sheet>
    );
  }

  const chip = chipDe(turno);
  const acciones = accionesDelDetalle(turno, sesion, new Date());
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
      setError(mensajeParaElla(err));
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

  // Si falla, el selector se queda abierto y lo dice ahí. Si entra, se
  // avisa en el acto y no al terminar el tilde: el detalle se puede cerrar
  // en el medio (Escape, tocar afuera) y la agenda tiene que enterarse igual.
  // Primero la marca en la fila, después el cierre: el trazo de la fila
  // empieza mientras el sheet se va.
  async function cobrar(metodo: MetodoPago) {
    if (!turno) return;
    await cobrarTurno(turno.id, metodo);
    onCobrado?.(turno.id);
    onUpdated(COBRADO);
  }

  function deshacer() {
    return ejecutar(async (actual) => {
      await deshacerCobro(actual.id, actual.actualizadoEn);
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
        {acciones.puedeGrabarORevisar ? <BriefCorto pacienteId={turno.paciente.id} /> : null}

        {modo === "ver" ? (
          <>
            <DatosDelTurno turno={turno} aviso={aviso} />
            <AccionesDelTurno
              turno={turno}
              acciones={acciones}
              enviando={enviando}
              onModo={(siguiente) => {
                setError(null);
                setModo(siguiente);
              }}
              onReprogramar={abrirReprogramar}
            />

          </>
        ) : null}

        {/* Cobrar: elegir método */}
        {modo === "cobrar" ? (
          <div className="border-t border-[color:var(--border-subtle)] pt-5">
            <SelectorMetodoPago
              monto={turno.tarifaCobrada}
              cierraElTurno={acciones.esProgramado}
              onElegir={cobrar}
              onListo={() => {}}
              onVolver={() => setModo("ver")}
            />
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
            cancelar={VOLVER}
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
            cancelar={VOLVER}
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
            cancelar={VOLVER}
            enviando={enviando}
            enviandoLabel={DESHACIENDO_COBRO}
            onConfirmar={() => void deshacer()}
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
                {VOLVER}
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

