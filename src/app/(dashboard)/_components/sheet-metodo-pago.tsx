"use client";

// "¿Cómo pagó?" — la única pregunta que hace falta para cerrar un cobro.
// Mismos seis métodos que el sheet del turno en la agenda.
//
// La confirmación se dibuja acá, sobre el método que ella tocó, y no sólo en
// el toast: el toast aparece abajo de todo, del otro lado de la pantalla, y
// lo que se está confirmando pasó en este renglón. El sheet se queda abierto
// lo que dura el trazo (useConfirmacionDibujada) y se cierra solo.

import * as React from "react";

import { Sheet } from "@/components/ui";
import { CheckDibujado, useConfirmacionDibujada } from "@/components/ui/movimiento";
import { METODO_DE_PAGO } from "@/lib/glosario";
import type { MetodoPago } from "@/types/domain";

const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

export function SheetMetodoPago({
  open,
  onClose,
  onElegir,
}: {
  open: boolean;
  onClose: () => void;
  /** Registra el cobro. Resuelve cuando quedó guardado; si rechaza, el sheet
   *  se cierra sin dibujar el check y el error lo cuenta quien lo maneje. */
  onElegir: (metodo: MetodoPago) => Promise<void>;
}) {
  const [enVuelo, setEnVuelo] = React.useState<MetodoPago | null>(null);
  const [confirmado, confirmar] = useConfirmacionDibujada<MetodoPago>(onClose);

  const bloqueado = enVuelo !== null || confirmado !== null;

  async function elegir(metodo: MetodoPago) {
    if (bloqueado) return;
    setEnVuelo(metodo);
    try {
      await onElegir(metodo);
      confirmar(metodo);
    } catch {
      // El check confirma lo que efectivamente pasó: si el cobro falló, no
      // se dibuja nada y el sheet se va.
      onClose();
    } finally {
      setEnVuelo(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} ariaLabel={METODO_DE_PAGO} maxWidth={420}>
      <h3 className="mb-4 font-[family-name:var(--font-display)] text-[20px] font-medium text-ink-900">
        {METODO_DE_PAGO}
      </h3>
      <div className="-mx-6 overflow-hidden rounded-[8px] border border-[color:var(--border-subtle)] lg:-mx-1">
        {METODOS_PAGO.map((metodo, i) => (
          <button
            key={metodo.value}
            type="button"
            disabled={bloqueado}
            onClick={() => void elegir(metodo.value)}
            className={`flex w-full items-center justify-between gap-3 bg-cream-50 px-4 py-3 text-left text-[14px] text-ink-900 transition-colors duration-150 hover:bg-cream-100 disabled:hover:bg-cream-50 ${
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
    </Sheet>
  );
}
