"use client";

import * as React from "react";

import { Button } from "@/components/ui";
import { esAbort } from "@/lib/api-client";
import { fechaLarga, money } from "@/lib/format";
import {
  BUSCANDO_SESIONES,
  ELEGIR_METODO_DE_PAGO,
  MARCAR_TODAS,
  REGISTRAR_PAGO_TITULO,
  REINTENTAR,
  SESIONES_NO_CARGARON,
  YA_NO_DEBE,
  pluralizar,
} from "@/lib/glosario";
import type { Turno } from "@/types/domain";

import { leerSesionesImpagas } from "./datos";

// ============================================
// Registrar pago: las sesiones sin cobrar de esa paciente, para marcar las
// que pagó. Con una sola ya viene marcada; con varias no se marca ninguna
// por ella: anotar de más un cobro es peor que un toque extra, y "Marcar
// todas" queda a mano. El método se elige después, una vez para todas.
// ============================================
export function RegistrarPago({
  pacienteId,
  onElegirMetodo,
  onCancelar,
}: {
  pacienteId: string;
  onElegirMetodo: (turnoIds: string[]) => void;
  onCancelar: () => void;
}) {
  const [sesiones, setSesiones] = React.useState<Turno[] | "error" | null>(null);
  const [marcadas, setMarcadas] = React.useState<ReadonlySet<string>>(new Set());
  const [intento, setIntento] = React.useState(0);
  const tituloId = React.useId();

  React.useEffect(() => {
    const controller = new AbortController();
    leerSesionesImpagas(pacienteId, controller.signal)
      .then((impagas) => {
        setSesiones(impagas);
        setMarcadas(new Set(impagas.length === 1 ? [impagas[0].id] : []));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setSesiones("error");
      });
    return () => controller.abort();
  }, [pacienteId, intento]);

  const alternar = (id: string) =>
    setMarcadas((actual) => {
      const siguiente = new Set(actual);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });

  const lista = Array.isArray(sesiones) ? sesiones : [];
  const elegidas = lista.filter((t) => marcadas.has(t.id));
  const total = elegidas.reduce((suma, t) => suma + t.tarifaCobrada, 0);

  return (
    <section
      aria-labelledby={tituloId}
      className="mt-3 rounded-[10px] border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={tituloId} className="text-[14px] font-semibold text-ink-900">
          {REGISTRAR_PAGO_TITULO}
        </h3>
        {lista.length > 1 && elegidas.length < lista.length ? (
          <button
            type="button"
            onClick={() => setMarcadas(new Set(lista.map((t) => t.id)))}
            className="min-h-[44px] shrink-0 px-1 text-[13px] font-medium text-sage-600 underline-offset-2 hover:underline lg:min-h-0"
          >
            {MARCAR_TODAS}
          </button>
        ) : null}
      </div>

      {sesiones === null ? (
        <p className="mt-2 text-[13px] text-ink-500">{BUSCANDO_SESIONES}</p>
      ) : sesiones === "error" ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-700">
          {SESIONES_NO_CARGARON}{" "}
          <button
            type="button"
            onClick={() => {
              setSesiones(null);
              setIntento((n) => n + 1);
            }}
            className="font-medium text-sage-600 underline underline-offset-2"
          >
            {REINTENTAR}
          </button>
        </p>
      ) : lista.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-500">{YA_NO_DEBE}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--border-subtle)]">
          {lista.map((t) => (
            <li key={t.id}>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={marcadas.has(t.id)}
                  onChange={() => alternar(t.id)}
                  className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
                />
                <span className="min-w-0 flex-1 text-[14px] text-ink-900">
                  Sesión del {fechaLarga(t.fecha)}
                </span>
                <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-ink-700">
                  {money(t.tarifaCobrada)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p aria-live="polite" className="text-[13px] text-ink-500">
          {elegidas.length > 0
            ? `${pluralizar(elegidas.length, "sesión", "sesiones")} · ${money(total)}`
            : " "}
        </p>
        {/* En el teléfono van apilados, el principal arriba: lado a lado,
            "Elegir método de pago" se partía en tres renglones. */}
        <div className="flex flex-col-reverse gap-2 lg:flex-row">
          <Button variant="secondary" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={elegidas.length === 0}
            onClick={() => onElegirMetodo(elegidas.map((t) => t.id))}
          >
            {ELEGIR_METODO_DE_PAGO}
          </Button>
        </div>
      </div>
    </section>
  );
}
