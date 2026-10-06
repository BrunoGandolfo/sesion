"use client";

// El formulario de agendar un turno. Es uno solo y lo usan Hoy (dentro de
// sheet-nuevo-turno) y Agenda (agenda-view): antes había dos copias, y la de
// Agenda había crecido con tres cosas que la de Hoy no tenía —propone día y
// hora a partir del último turno del paciente, "Crear a X" crea el paciente
// de verdad con nombre y teléfono inline, y el botón "Agendar" queda fijo al
// pie—. Quedó esa. Los campos del turno (fecha, hora, duración, modalidad,
// notas) viven en turno-editar-campos.tsx, compartidos con "Reprogramar".
// Las lecturas y reglas están en nuevo-turno-datos.ts; el buscador de
// paciente, en buscador-paciente.tsx.
//
// Quien lo monta le da el padding lateral (px-6 lg:px-7): el pie fijo lo
// cancela con márgenes negativos para ir a sangre.

import * as React from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button, Input, Segmented } from "@/components/ui";
import { esAbort, mensajeParaElla } from "@/lib/api-client";
import {
  frecuenciaTurnoSchema,
  FRECUENCIAS_TURNO,
  type FrecuenciaTurno,
} from "@/lib/constantes-turno";
import {
  agregarDiasMvd,
  fechaInputMvd,
  horaInputMvd,
} from "@/lib/fechas-montevideo";
import { fechaLarga, hora as formatHora, money } from "@/lib/format";
import {
  FRECUENCIA_LABEL,
  SE_REPITE,
  AYUDA_SERIE,
  PACIENTE_YA_CREADA,
  TARIFA_SIN_CARGAR,
} from "@/lib/glosario";
import type { Duracion, Modalidad } from "@/types/domain";

import { BuscadorPaciente, useBuscadorPaciente } from "./buscador-paciente";
import {
  crearPacienteRapido,
  leerPropuesta,
  mensajeDeCreacion,
  tarifaUsable as esTarifaUsable,
  type PacienteOpcion,
} from "./nuevo-turno-datos";
import {
  CAMPOS_TURNO_DEFAULT,
  TurnoEditarCampos,
  camposTurnoSchema,
} from "./turno-editar-campos";

const schema = camposTurnoSchema.extend({
  pacienteId: z.string(),
  frecuencia: frecuenciaTurnoSchema,
});

type Valores = z.infer<typeof schema>;

export interface NuevoTurnoData {
  pacienteId: string;
  fecha: string;
  hora: string;
  duracion: Duracion;
  modalidad: Modalidad;
  notas: string;
  /** "unico", o la frecuencia de la serie que se repite tres meses. */
  frecuencia: FrecuenciaTurno;
}

const OPCIONES_FRECUENCIA = FRECUENCIAS_TURNO.map((value) => ({ value, label: FRECUENCIA_LABEL[value] }));


interface NuevoTurnoFormProps {
  pacientes: PacienteOpcion[];
  /** Tarifa por sesión de Tu consultorio, para "Crear a X". null si no se
   *  pudo leer (o no se pidió): en ese caso no se pueden crear pacientes
   *  desde acá, y el formulario lo dice. */
  tarifaDefault?: number | null;
  /** Día que está mirando en la agenda: es la fecha inicial del turno.
   *  Sin él (Hoy), propone mañana. */
  fechaInicial?: Date | null;
  /** Crea el turno. Lanza ApiClientError si la API lo rechaza. */
  onSubmit: (data: NuevoTurnoData) => Promise<void>;
  onCancel: () => void;
}

export function NuevoTurnoForm({
  pacientes,
  tarifaDefault = null,
  fechaInicial = null,
  onSubmit,
  onCancel,
}: NuevoTurnoFormProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  const metodos = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...CAMPOS_TURNO_DEFAULT,
      pacienteId: "",
      frecuencia: "unico",
      fecha: fechaInputMvd(fechaInicial ?? agregarDiasMvd(new Date(), 1)),
      hora: "10:00",
    },
    mode: "onSubmit",
  });
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors },
  } = metodos;
  const frecuencia = useWatch({ control, name: "frecuencia" });

  const pacienteId = useWatch({ control, name: "pacienteId" });

  // "Crear a X": dos campos inline en vez de la ficha completa.
  const [creando, setCreando] = React.useState(false);
  const [nuevoNombre, setNuevoNombre] = React.useState("");
  const [nuevoTelefono, setNuevoTelefono] = React.useState("");
  const [errorNuevo, setErrorNuevo] = React.useState<string | null>(null);
  // El paciente que ya creó "Crear a X". Si el turno se rechaza (un 409 por
  // choque, por ejemplo) y ella reintenta con otra hora, se reusa: antes cada
  // reintento creaba otro paciente con el mismo nombre. Se olvida al empezar
  // a crear de nuevo.
  const [pacienteCreado, setPacienteCreado] = React.useState<string | null>(null);

  const [propuesta, setPropuesta] = React.useState<Date | null>(null);
  // La consulta del último turno llega segundos después de elegir el
  // paciente, y hasta acá escribía fecha y hora sin mirar nada: quien ya las
  // había escrito veía su horario reemplazado por la propuesta, y el 409 de
  // superposición que contestaba el servidor hablaba de un horario que ella
  // no había elegido. Desde que toca cualquiera de los dos campos, la
  // propuesta se sigue mostrando en el texto de abajo pero no se aplica. Es
  // un ref y no estado porque lo lee el `.then` de un pedido ya en vuelo.
  const fechaUHoraEditadaRef = React.useRef(false);
  const [enviando, setEnviando] = React.useState(false);
  const [errorEnvio, setErrorEnvio] = React.useState<string | null>(null);

  const tarifaUsable = esTarifaUsable(tarifaDefault);

  const pacienteElegido = React.useMemo(
    () => pacientes.find((p) => p.id === pacienteId) ?? null,
    [pacientes, pacienteId],
  );

  const buscador = useBuscadorPaciente({
    pacientes,
    elegido: pacienteElegido,
    onElegir: (p) => {
      setValue("pacienteId", p.id, { shouldDirty: true });
      clearErrors("pacienteId");
      setCreando(false);
      setErrorNuevo(null);
    },
    onCrear: (texto) => {
      setValue("pacienteId", "", { shouldDirty: true });
      clearErrors("pacienteId");
      setNuevoNombre(texto);
      setNuevoTelefono("");
      setErrorNuevo(null);
      setPropuesta(null);
      setPacienteCreado(null);
      setCreando(true);
    },
    onSoltar: () => {
      setValue("pacienteId", "", { shouldDirty: true });
      setPropuesta(null);
    },
  });
  const { cerrar } = buscador;

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      cerrar();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [cerrar]);

  // Día y hora propuestos desde el último turno del paciente elegido.
  React.useEffect(() => {
    if (!pacienteId) return;
    const controller = new AbortController();

    leerPropuesta(pacienteId, controller.signal)
      .then((sugerida) => {
        setPropuesta(sugerida);
        if (!sugerida || fechaUHoraEditadaRef.current) return;
        setValue("fecha", fechaInputMvd(sugerida), { shouldDirty: true });
        setValue("hora", horaInputMvd(sugerida), { shouldDirty: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        // Sin propuesta: quedan la fecha y la hora que ya estaban.
        setPropuesta(null);
      });

    return () => controller.abort();
  }, [pacienteId, setValue]);

  const cancelarCrear = () => {
    setCreando(false);
    setErrorNuevo(null);
  };

  const enviar = handleSubmit(async (valores) => {
    setErrorEnvio(null);
    setErrorNuevo(null);

    let idPaciente = valores.pacienteId;

    if (!creando && !idPaciente) {
      setError("pacienteId", { message: "Elegí un paciente" });
      return;
    }

    setEnviando(true);
    try {
      if (creando && pacienteCreado) {
        idPaciente = pacienteCreado;
      } else if (creando) {
        try {
          idPaciente = await crearPacienteRapido({
            nombreYApellido: nuevoNombre,
            telefono: nuevoTelefono,
            tarifaDefault,
          });
          setPacienteCreado(idPaciente);
        } catch (err) {
          setErrorNuevo(mensajeDeCreacion(err));
          return;
        }
      }

      await onSubmit({
        pacienteId: idPaciente,
        fecha: valores.fecha,
        hora: valores.hora,
        duracion: valores.duracion,
        modalidad: valores.modalidad,
        notas: valores.notas ?? "",
        frecuencia: valores.frecuencia,
      });
    } catch (err) {
      setErrorEnvio(mensajeParaElla(err));
    } finally {
      setEnviando(false);
    }
  });

  return (
    <div ref={rootRef} className="flex flex-col">
      <div className="border-b border-[color:var(--border-subtle)] pb-4 pt-1 lg:pt-0">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Nuevo turno
        </p>
        <h2 className="mt-1 font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Agendar
        </h2>
      </div>

      <FormProvider {...metodos}>
      <form onSubmit={enviar} noValidate className="flex flex-col">
        <input type="hidden" {...register("pacienteId")} />

        <div className="flex flex-col gap-5 py-5">
          <BuscadorPaciente buscador={buscador} error={errors.pacienteId?.message} />

          {/* Crear paciente inline */}
          {creando ? (
            <div className="flex flex-col gap-3 rounded-md border border-sage-500/40 bg-sage-50 px-4 py-4">
              <p className="text-[13px] font-semibold text-ink-900">
                Paciente nuevo
              </p>
              {/* Creada: los campos dejan de aceptar cambios. Editarlos no
                  hacía nada —el reenvío usa la que ya existe— y no lo decía. */}
              <Input
                label="Nombre y apellido"
                autoComplete="off"
                value={nuevoNombre}
                disabled={pacienteCreado !== null}
                onChange={(e) => setNuevoNombre(e.target.value)}
              />
              <Input
                label="Teléfono"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+598 99 123 456"
                value={nuevoTelefono}
                disabled={pacienteCreado !== null}
                onChange={(e) => setNuevoTelefono(e.target.value)}
              />
              <p className="text-[12px] leading-[1.5] text-ink-500">
                {pacienteCreado !== null
                  ? PACIENTE_YA_CREADA
                  : tarifaUsable && tarifaDefault !== null
                    ? `Se crea con la tarifa de Tu consultorio (${money(tarifaDefault)}). El resto de la ficha se completa después.`
                    : TARIFA_SIN_CARGAR}
              </p>
              {errorNuevo ? (
                <p
                  role="alert"
                  className="text-[12px] text-[color:var(--color-error)]"
                >
                  {errorNuevo}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelarCrear}
                  disabled={enviando}
                >
                  No crear
                </Button>
              </div>
            </div>
          ) : null}

          <TurnoEditarCampos
            onFechaUHoraEditada={() => {
              fechaUHoraEditadaRef.current = true;
            }}
          >
            {propuesta && pacienteElegido ? (
              <p className="-mt-2 text-[12px] leading-[1.5] text-ink-500">
                Propuesto desde el último turno de {pacienteElegido.nombre}:{" "}
                {fechaLarga(propuesta)} a las {formatHora(propuesta)}. Podés
                cambiarlo.
              </p>
            ) : null}
          </TurnoEditarCampos>

          {/* Repetición: una vez, o una serie de tres meses */}
          <div className="space-y-2">
            <input type="hidden" {...register("frecuencia")} />
            <span className="block font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {SE_REPITE}
            </span>
            <Segmented
              ariaLabel={SE_REPITE}
              value={frecuencia}
              onChange={(valor: FrecuenciaTurno) =>
                setValue("frecuencia", valor, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              options={OPCIONES_FRECUENCIA}
            />
            {frecuencia !== "unico" ? (
              <p className="text-[12px] leading-[1.5] text-ink-500">{AYUDA_SERIE}</p>
            ) : null}
          </div>

          {errorEnvio ? (
            <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
              {errorEnvio}
            </p>
          ) : null}
        </div>

        {/* Pie fijo: "Agendar" siempre a la vista, por encima del menú. */}
        <div className="sticky bottom-[64px] z-10 -mx-6 border-t border-[color:var(--border-subtle)] bg-white px-6 py-4 lg:bottom-0 lg:-mx-7 lg:px-7">
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                enviando || (creando && pacienteCreado === null && !tarifaUsable)
              }
            >
              {enviando ? "Agendando…" : "Agendar"}
            </Button>
          </div>
        </div>
      </form>
      </FormProvider>
    </div>
  );
}
