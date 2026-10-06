"use client";

// El buscador de paciente del formulario de agendar: un combobox con la
// lista filtrada y, si nada coincide, la opción "Crear a X". El estado de la
// búsqueda vive en useBuscadorPaciente; el formulario decide qué pasa al
// elegir, al crear y al editar el texto.

import * as React from "react";
import { Plus } from "lucide-react";

import { Avatar, Input } from "@/components/ui";
import { money } from "@/lib/format";

import { coincide, nombreCompleto, type PacienteOpcion } from "./nuevo-turno-datos";

interface OpcionesBuscador {
  pacientes: PacienteOpcion[];
  /** El paciente elegido hoy: si el texto deja de ser su nombre, se suelta. */
  elegido: PacienteOpcion | null;
  onElegir: (p: PacienteOpcion) => void;
  /** "Crear a X" con el texto de la búsqueda. */
  onCrear: (texto: string) => void;
  /** El texto dejó de nombrar al paciente elegido. */
  onSoltar: () => void;
}

export function useBuscadorPaciente({ pacientes, elegido, onElegir, onCrear, onSoltar }: OpcionesBuscador) {
  const closeTimerRef = React.useRef<number | null>(null);
  const [busqueda, setBusqueda] = React.useState("");
  const [abierto, setAbierto] = React.useState(false);
  const [indiceActivo, setIndiceActivo] = React.useState(0);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

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

  const elegir = (p: PacienteOpcion) => {
    onElegir(p);
    setBusqueda(nombreCompleto(p));
    setAbierto(false);
    setIndiceActivo(0);
  };

  const cerrar = React.useCallback(() => setAbierto(false), []);

  const crear = () => {
    onCrear(busquedaLimpia);
    setAbierto(false);
  };

  const cancelarCierre = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const onChange = (valor: string) => {
    setBusqueda(valor);
    if (elegido && valor !== nombreCompleto(elegido)) onSoltar();
    setAbierto(true);
    setIndiceActivo(0);
  };

  const onBlur = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setAbierto(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
        crear();
        return;
      }
      const p = filtrados[indiceEfectivo];
      if (p) elegir(p);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setAbierto(false);
    }
  };

  const onFocus = () => {
    setAbierto(true);
    setIndiceActivo(0);
  };

  return {
    busqueda,
    busquedaLimpia,
    abierto,
    cerrar,
    filtrados,
    puedeCrear,
    cantidadOpciones,
    hayOpciones,
    indiceEfectivo,
    setIndiceActivo,
    elegir,
    crear,
    cancelarCierre,
    onChange,
    onBlur,
    onKeyDown,
    onFocus,
  };
}

export function BuscadorPaciente({
  buscador,
  error,
}: {
  buscador: ReturnType<typeof useBuscadorPaciente>;
  error?: string;
}) {
  const listaId = React.useId();
  const {
    busqueda,
    busquedaLimpia,
    abierto,
    filtrados,
    puedeCrear,
    cantidadOpciones,
    hayOpciones,
    indiceEfectivo,
    setIndiceActivo,
  } = buscador;

  return (
    <div className="relative">
      <div onBlur={buscador.onBlur}>
        <Input
          label="Paciente"
          placeholder="Buscar por nombre…"
          value={busqueda}
          error={error}
          aria-autocomplete="list"
          aria-controls={listaId}
          aria-expanded={abierto}
          aria-haspopup="listbox"
          aria-activedescendant={
            abierto && hayOpciones
              ? `${listaId}-opcion-${indiceEfectivo}`
              : undefined
          }
          onFocus={buscador.onFocus}
          onChange={(e) => buscador.onChange(e.target.value)}
          onKeyDown={buscador.onKeyDown}
        />
      </div>

      {abierto ? (
        <div
          role="listbox"
          id={listaId}
          className="absolute left-0 right-0 top-full z-10 mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-[color:var(--border-subtle)] bg-white shadow-raised"
          onMouseDown={buscador.cancelarCierre}
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
                onClick={() => buscador.elegir(p)}
                className={`flex w-full items-center gap-3 px-[14px] py-[10px] text-left transition-colors duration-[var(--duration-fast)] ${
                  activo ? "bg-cream-50" : "bg-white hover:bg-cream-50"
                }`}
              >
                <Avatar nombre={p.nombre} apellido={p.apellido} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink-900">
                    {nombreCompleto(p)}
                  </span>
                  <span className="block tabular-nums text-[12px] text-ink-500">
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
              onClick={buscador.crear}
              className={`flex w-full items-center gap-2 px-[14px] py-[10px] text-left transition-colors duration-[var(--duration-fast)] ${
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
                <span className="block tabular-nums text-[12px] text-ink-500">
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
  );
}
