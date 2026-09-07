"use client";

// Agendar un turno desde la agenda.
//
// Tres cosas que el formulario compartido (components/forms) no hacía:
//   - propone día y hora a partir del último turno del paciente (mismo día
//     de la semana y misma hora, una semana después del último), si existe;
//   - "Crear a X" crea el paciente de verdad, con nombre y teléfono en dos
//     campos inline, y sigue con el turno; la tarifa sale de Tu consultorio;
//   - el botón "Agendar" queda fijo al pie, por encima del menú inferior.

import * as React from "react";
import { addDays, addWeeks } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";

import { Avatar, Button, Input, Segmented, Textarea } from "@/components/ui";
import { ApiClientError, apiGet, apiPost, esAbort } from "@/lib/api-client";
// Los inputs se llenan con el reloj de Montevideo porque así los lee después
// instanteDesdeFechaHoraMvd al enviar. Con getFullYear/getHours el par no
// cerraba: desde Madrid, la propuesta "el mismo día y hora que la última vez"
// mostraba las 20:15 de un turno de las 15:15 y lo agendaba a las 20:15 de
// Montevideo, cinco horas tarde.
import {
  agregarDiasMvd,
  fechaInputMvd,
  horaInputMvd,
} from "@/lib/fechas-montevideo";
import { fechaLarga, hora as formatHora, money } from "@/lib/format";
import { ALGO_FALLO } from "@/lib/glosario";
import type { Duracion, Modalidad, Paciente } from "@/types/domain";

const DURACIONES: Duracion[] = [30, 45, 50, 60, 90];

const schema = z.object({
  pacienteId: z.string(),
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

type Valores = z.infer<typeof schema>;

export interface NuevoTurnoData {
  pacienteId: string;
  fecha: string;
  hora: string;
  duracion: Duracion;
  modalidad: Modalidad;
  notas: string;
}

type PacienteOpcion = Pick<Paciente, "id" | "nombre" | "apellido" | "tarifa">;

export interface NuevoTurnoFormProps {
  pacientes: PacienteOpcion[];
  /** Tarifa por sesión de Tu consultorio. null si no se pudo leer. */
  tarifaDefault: number | null;
  /** Día que está mirando en la agenda: es la fecha inicial del turno. */
  fechaInicial: Date | null;
  /** Crea el turno. Lanza ApiClientError si la API lo rechaza. */
  onSubmit: (data: NuevoTurnoData) => Promise<void>;
  onCancel: () => void;
}

type JsonTurno = { fecha: string };

function nombreCompleto(p: Pick<Paciente, "nombre" | "apellido">) {
  return `${p.nombre} ${p.apellido}`.trim();
}

function coincide(p: Pick<Paciente, "nombre" | "apellido">, q: string) {
  const aguja = q.trim().toLowerCase();
  if (!aguja) return true;
  return nombreCompleto(p).toLowerCase().includes(aguja);
}

/** Una semana después del último turno, avanzando de a semanas hasta que
 *  quede en el futuro. Conserva día de la semana y hora. */
export function proponerDesdeUltimoTurno(ultimo: Date, ahora: Date): Date {
  let propuesta = addWeeks(ultimo, 1);
  while (propuesta.getTime() <= ahora.getTime()) {
    propuesta = addWeeks(propuesta, 1);
  }
  return propuesta;
}

/** "Ana María Pérez" → { nombre: "Ana María", apellido: "Pérez" }. */
function separarNombre(texto: string): { nombre: string; apellido: string } {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return { nombre: partes[0] ?? "", apellido: "" };
  return {
    nombre: partes.slice(0, -1).join(" "),
    apellido: partes[partes.length - 1],
  };
}

export function NuevoTurnoForm({
  pacientes,
  tarifaDefault,
  fechaInicial,
  onSubmit,
  onCancel,
}: NuevoTurnoFormProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const listaId = React.useId();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors },
  } = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: {
      pacienteId: "",
      fecha: fechaInputMvd(fechaInicial ?? agregarDiasMvd(new Date(), 1)),
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

  const [busqueda, setBusqueda] = React.useState("");
  const [abierto, setAbierto] = React.useState(false);
  const [indiceActivo, setIndiceActivo] = React.useState(0);

  // "Crear a X": dos campos inline en vez de la ficha completa.
  const [creando, setCreando] = React.useState(false);
  const [nuevoNombre, setNuevoNombre] = React.useState("");
  const [nuevoTelefono, setNuevoTelefono] = React.useState("");
  const [errorNuevo, setErrorNuevo] = React.useState<string | null>(null);

  const [propuesta, setPropuesta] = React.useState<Date | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [errorEnvio, setErrorEnvio] = React.useState<string | null>(null);

  const pacienteElegido = React.useMemo(
    () => pacientes.find((p) => p.id === pacienteId) ?? null,
    [pacientes, pacienteId],
  );

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setAbierto(false);
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

  // Día y hora propuestos desde el último turno del paciente elegido.
  React.useEffect(() => {
    if (!pacienteId) return;
    const controller = new AbortController();
    const ahora = new Date();
    const desde = addDays(ahora, -180).toISOString();
    const hasta = addDays(ahora, 180).toISOString();

    apiGet<JsonTurno[]>(
      `/api/turnos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&pacienteId=${encodeURIComponent(pacienteId)}`,
      { signal: controller.signal },
    )
      .then((turnos) => {
        if (turnos.length === 0) {
          setPropuesta(null);
          return;
        }
        const ultimo = turnos
          .map((t) => new Date(t.fecha))
          .sort((a, b) => b.getTime() - a.getTime())[0];
        const sugerida = proponerDesdeUltimoTurno(ultimo, new Date());
        setPropuesta(sugerida);
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

  const filtrados = React.useMemo(
    () => pacientes.filter((p) => coincide(p, busqueda)),
    [pacientes, busqueda],
  );

  const busquedaLimpia = busqueda.trim();
  const puedeCrear = busquedaLimpia.length > 0 && filtrados.length === 0;
  const cantidadOpciones = filtrados.length + (puedeCrear ? 1 : 0);
  const hayOpciones = cantidadOpciones > 0;
  const indiceEfectivo =
    abierto && cantidadOpciones > 0
      ? Math.min(indiceActivo, cantidadOpciones - 1)
      : 0;

  const elegirPaciente = React.useCallback(
    (p: PacienteOpcion) => {
      setValue("pacienteId", p.id, { shouldDirty: true });
      clearErrors("pacienteId");
      setBusqueda(nombreCompleto(p));
      setCreando(false);
      setErrorNuevo(null);
      setAbierto(false);
      setIndiceActivo(0);
    },
    [setValue, clearErrors],
  );

  const empezarACrear = () => {
    setValue("pacienteId", "", { shouldDirty: true });
    clearErrors("pacienteId");
    setNuevoNombre(busquedaLimpia);
    setNuevoTelefono("");
    setErrorNuevo(null);
    setPropuesta(null);
    setCreando(true);
    setAbierto(false);
  };

  const cancelarCrear = () => {
    setCreando(false);
    setErrorNuevo(null);
  };

  const onBusquedaChange = (valor: string) => {
    setBusqueda(valor);
    if (pacienteElegido && valor !== nombreCompleto(pacienteElegido)) {
      setValue("pacienteId", "", { shouldDirty: true });
      setPropuesta(null);
    }
    setAbierto(true);
    setIndiceActivo(0);
  };

  const onBusquedaBlur = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setAbierto(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const onBusquedaKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!abierto && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setAbierto(true);
      return;
    }
    if (!hayOpciones) {
      if (event.key === "Escape") setAbierto(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndiceActivo((i) => (i + 1) % cantidadOpciones);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndiceActivo((i) => (i - 1 + cantidadOpciones) % cantidadOpciones);
    } else if (event.key === "Enter" && abierto) {
      event.preventDefault();
      if (puedeCrear && indiceEfectivo === cantidadOpciones - 1) {
        empezarACrear();
        return;
      }
      const p = filtrados[indiceEfectivo];
      if (p) elegirPaciente(p);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setAbierto(false);
    }
  };

  /** Crea el paciente con nombre, teléfono y la tarifa de Tu consultorio. */
  async function crearPaciente(): Promise<string> {
    const { nombre, apellido } = separarNombre(nuevoNombre);
    if (!nombre || !apellido) {
      throw new Error("Ingresá nombre y apellido");
    }
    if (!nuevoTelefono.trim()) {
      throw new Error("Ingresá el teléfono");
    }
    if (tarifaDefault === null) {
      throw new Error(
        "No pudimos leer tu tarifa por sesión. Cargala en Tu consultorio y probá de nuevo.",
      );
    }
    const creado = await apiPost<Paciente>("/api/pacientes", {
      nombre,
      apellido,
      telefono: nuevoTelefono.trim(),
      email: null,
      tarifa: tarifaDefault,
      notas: null,
    });
    return creado.id;
  }

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
      if (creando) {
        try {
          idPaciente = await crearPaciente();
        } catch (err) {
          setErrorNuevo(
            err instanceof ApiClientError
              ? err.mensaje
              : err instanceof Error
                ? err.message
                : ALGO_FALLO,
          );
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
      });
    } catch (err) {
      setErrorEnvio(err instanceof ApiClientError ? err.mensaje : ALGO_FALLO);
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

      <form onSubmit={enviar} noValidate className="flex flex-col">
        <input type="hidden" {...register("pacienteId")} />
        <input type="hidden" {...register("duracion", { valueAsNumber: true })} />
        <input type="hidden" {...register("modalidad")} />

        <div className="flex flex-col gap-5 py-5">
          {/* Paciente */}
          <div className="relative">
            <div onBlur={onBusquedaBlur}>
              <Input
                label="Paciente"
                placeholder="Buscar por nombre…"
                value={busqueda}
                error={errors.pacienteId?.message}
                aria-autocomplete="list"
                aria-controls={listaId}
                aria-expanded={abierto}
                aria-haspopup="listbox"
                aria-activedescendant={
                  abierto && hayOpciones
                    ? `${listaId}-opcion-${indiceEfectivo}`
                    : undefined
                }
                onFocus={() => {
                  setAbierto(true);
                  setIndiceActivo(0);
                }}
                onChange={(e) => onBusquedaChange(e.target.value)}
                onKeyDown={onBusquedaKeyDown}
              />
            </div>

            {abierto ? (
              <div
                role="listbox"
                id={listaId}
                className="absolute left-0 right-0 top-full z-10 mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-[color:var(--border-subtle)] bg-white shadow-raised"
                onMouseDown={() => {
                  if (closeTimerRef.current !== null) {
                    window.clearTimeout(closeTimerRef.current);
                    closeTimerRef.current = null;
                  }
                }}
              >
                {filtrados.map((p, index) => {
                  const activo = index === indiceEfectivo;
                  return (
                    <button
                      key={p.id}
                      id={`${listaId}-opcion-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activo}
                      onMouseEnter={() => setIndiceActivo(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => elegirPaciente(p)}
                      className={`flex w-full items-center gap-3 px-[14px] py-[10px] text-left transition-colors duration-150 ${
                        activo ? "bg-cream-50" : "bg-white hover:bg-cream-50"
                      }`}
                    >
                      <Avatar nombre={p.nombre} apellido={p.apellido} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink-900">
                          {nombreCompleto(p)}
                        </span>
                        <span className="block text-[12px] text-ink-500">
                          {money(p.tarifa)}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {puedeCrear ? (
                  <button
                    id={`${listaId}-opcion-${cantidadOpciones - 1}`}
                    type="button"
                    role="option"
                    aria-selected={indiceEfectivo === cantidadOpciones - 1}
                    onMouseEnter={() => setIndiceActivo(cantidadOpciones - 1)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={empezarACrear}
                    className={`flex w-full items-center gap-2 px-[14px] py-[10px] text-left transition-colors duration-150 ${
                      indiceEfectivo === cantidadOpciones - 1
                        ? "bg-cream-50"
                        : "bg-white hover:bg-cream-50"
                    }`}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-50 text-sage-600">
                      <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink-900">
                        Crear a {busquedaLimpia}
                      </span>
                      <span className="block text-[12px] text-ink-500">
                        Nombre y teléfono, y seguimos con el turno
                      </span>
                    </span>
                  </button>
                ) : null}

                {!hayOpciones ? (
                  <div className="px-[14px] py-[12px] text-[13px] text-ink-500">
                    No hay pacientes para mostrar.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Crear paciente inline */}
          {creando ? (
            <div className="flex flex-col gap-3 rounded-md border border-sage-500/40 bg-sage-50 px-4 py-4">
              <p className="text-[13px] font-semibold text-ink-900">
                Paciente nuevo
              </p>
              <Input
                label="Nombre y apellido"
                autoComplete="off"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
              />
              <Input
                label="Teléfono"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+598 99 123 456"
                value={nuevoTelefono}
                onChange={(e) => setNuevoTelefono(e.target.value)}
              />
              <p className="text-[12px] leading-[1.5] text-ink-500">
                {tarifaDefault !== null
                  ? `Se crea con la tarifa de Tu consultorio (${money(tarifaDefault)}). El resto de la ficha se completa después.`
                  : "No pudimos leer tu tarifa por sesión: cargala en Tu consultorio para crear pacientes desde acá."}
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

          {/* Fecha y hora */}
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
          {propuesta && pacienteElegido ? (
            <p className="-mt-2 text-[12px] leading-[1.5] text-ink-500">
              Propuesto desde el último turno de {pacienteElegido.nombre}:{" "}
              {fechaLarga(propuesta)} a las {formatHora(propuesta)}. Podés
              cambiarlo.
            </p>
          ) : null}

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
              options={[
                { value: "presencial", label: "Presencial" },
                { value: "online", label: "Online" },
              ]}
            />
          </div>

          <Textarea
            label="Notas (opcional)"
            placeholder="Algo para recordar del turno."
            error={errors.notas?.message}
            className="min-h-[72px]"
            {...register("notas")}
          />

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
            <Button type="submit" disabled={enviando}>
              {enviando ? "Agendando…" : "Agendar"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
