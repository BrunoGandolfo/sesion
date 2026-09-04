"use client";

// "¿Cómo pagó?" — la única pregunta que hace falta para cerrar un cobro.
// Mismos seis métodos que el sheet del turno en la agenda.

import { Sheet } from "@/components/ui";
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
  onElegir: (metodo: MetodoPago) => void;
}) {
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
            onClick={() => onElegir(metodo.value)}
            className={`flex w-full items-center bg-cream-50 px-4 py-3 text-left text-[14px] text-ink-900 transition-colors duration-150 hover:bg-cream-100 ${
              i !== METODOS_PAGO.length - 1
                ? "border-b border-[color:var(--border-subtle)]"
                : ""
            }`}
          >
            {metodo.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
