"use client";

// "¿Cómo pagó?" — el único selector de método de pago. Lo usan Hoy, Cobros,
// la ficha (turnos y sesiones) y el detalle del turno en la Agenda. Antes
// había tres, con tres títulos, tres textos de éxito y tres maneras de
// reaccionar a un error (forense 03, P3-17).
//
// Una sola política ante un error: el selector se queda abierto, no dibuja
// el tilde y dice por qué, en línea. Ella puede elegir otro método,
// reintentar o volver. El tilde sólo confirma lo que efectivamente entró.
//
// La confirmación se dibuja sobre el método que ella tocó, no sólo en el
// toast (que aparece del otro lado de la pantalla). El panel se sostiene lo
// que dura el trazo (useConfirmacionDibujada) y recién ahí avisa `onListo`.

import * as React from "react";

import { Button, Sheet } from "@/components/ui";
import { CheckDibujado, useConfirmacionDibujada } from "@/components/ui/movimiento";
import { mensajeParaElla } from "@/lib/api-client";
import { money } from "@/lib/format";
import {
  AL_COBRAR_QUEDA_REALIZADO,
  COMO_PAGO,
  METODOS_PAGO,
  METODO_DE_PAGO,
  NO_SE_PUDO_COBRAR,
  VOLVER,
} from "@/lib/glosario";
import type { MetodoPago } from "@/types/domain";

type PropsSelector = {
  /** Lo que se cobra, debajo del titular. */
  monto?: number;
  /** El turno sigue programado: cobrarlo lo marca realizado, y se avisa. */
  cierraElTurno?: boolean;
  /** Registra el cobro y actualiza la pantalla. Resuelve cuando quedó
   *  guardado; si rechaza, el selector muestra el error y sigue abierto. */
  onElegir: (metodo: MetodoPago) => Promise<void>;
  /** Qué decir si `onElegir` rechaza. Por defecto el `error` de la API o
   *  NO_SE_PUDO_COBRAR. */
  describirError?: (err: unknown) => string;
  /** El tilde terminó de dibujarse: hay que cerrar. */
  onListo: () => void;
  /** Ella se fue sin cobrar. */
  onVolver: () => void;
  /** Avisa si hay un cobro en vuelo, para que el contenedor no se cierre
   *  en el medio. */
  onEnVuelo?: (enVuelo: boolean) => void;
};

/** El contenido: titular, monto, los seis métodos, el error y Volver. */
export function SelectorMetodoPago({
  monto,
  cierraElTurno = false,
  onElegir,
  describirError = (err) => mensajeParaElla(err, NO_SE_PUDO_COBRAR),
  onListo,
  onVolver,
  onEnVuelo,
}: PropsSelector) {
  const [enVuelo, setEnVuelo] = React.useState<MetodoPago | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmado, confirmar] = useConfirmacionDibujada<MetodoPago>(onListo);
  const bloqueado = enVuelo !== null || confirmado !== null;

  async function elegir(metodo: MetodoPago) {
    if (bloqueado) return;
    setEnVuelo(metodo);
    setError(null);
    onEnVuelo?.(true);
    try {
      await onElegir(metodo);
      confirmar(metodo);
    } catch (err) {
      setError(describirError(err));
    } finally {
      setEnVuelo(null);
      onEnVuelo?.(false);
    }
  }

  return (
    <div>
      <h3 className="font-[family-name:var(--font-display)] text-[20px] font-medium text-ink-900">
        {COMO_PAGO}
      </h3>
      {monto !== undefined || cierraElTurno ? (
        <p className="mt-1 tabular-nums text-[13px] text-ink-700">
          {monto !== undefined ? money(monto) : null}
          {monto !== undefined && cierraElTurno ? " · " : null}
          {cierraElTurno ? AL_COBRAR_QUEDA_REALIZADO : null}
        </p>
      ) : null}
      <div className="-mx-6 mt-4 overflow-hidden rounded-[8px] border border-[color:var(--border-subtle)] lg:-mx-1">
        {METODOS_PAGO.map((metodo, i) => (
          <button
            key={metodo.value}
            type="button"
            disabled={bloqueado}
            onClick={() => void elegir(metodo.value)}
            className={`flex min-h-[44px] w-full items-center justify-between gap-3 bg-cream-50 px-4 py-3 text-left text-[14px] text-ink-900 transition-colors duration-[var(--duration-fast)] hover:bg-cream-100 disabled:hover:bg-cream-50 ${
              i !== METODOS_PAGO.length - 1
                ? "border-b border-[color:var(--border-subtle)]"
                : ""
            } ${bloqueado && confirmado !== metodo.value ? "opacity-50" : ""}`}
          >
            <span>{metodo.label}</span>
            {confirmado === metodo.value ? (
              <CheckDibujado tamano={18} className="shrink-0 text-sage-600" />
            ) : null}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-[color:var(--color-error)]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onVolver} disabled={bloqueado}>
          {VOLVER}
        </Button>
      </div>
    </div>
  );
}

/**
 * El selector en su propio sheet. `onClose` se llama al terminar el tilde o
 * cuando ella vuelve; con un cobro en vuelo, Escape o tocar afuera no
 * cierran: se cierra cuando se sabe si entró.
 */
export function SheetMetodoPago({
  open,
  onClose,
  ...selector
}: Omit<PropsSelector, "onListo" | "onVolver" | "onEnVuelo"> & {
  open: boolean;
  onClose: () => void;
}) {
  const enVuelo = React.useRef(false);
  const cerrar = () => {
    if (!enVuelo.current) onClose();
  };
  return (
    <Sheet open={open} onClose={cerrar} ariaLabel={METODO_DE_PAGO} maxWidth={420}>
      {open ? (
        <SelectorMetodoPago
          {...selector}
          onListo={onClose}
          onVolver={cerrar}
          onEnVuelo={(valor) => {
            enVuelo.current = valor;
          }}
        />
      ) : null}
    </Sheet>
  );
}
