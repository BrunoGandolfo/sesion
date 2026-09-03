"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle } from "lucide-react";

import { Button, Chip, Sheet, Toast } from "@/components/ui";
import { fechaCorta, hora, money, moneyShort } from "@/lib/format";
import type {
  MetodoPago,
  Modalidad,
  Turno,
  TurnoEstado,
} from "@/types/domain";

interface TurnosPagosTabProps {
  // Lo pasa paciente-detail-view; esta pestaña no lo usa. Se conserva en el
  // tipo para no romper al padre (fuera de este cambio).
  pacienteId: string;
  turnos: Turno[];
  onTurnoActualizado?: () => void;
}

type TurnoJson = Omit<
  Turno,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

type TurnoResponse = { data: TurnoJson };

type ToastState = { open: boolean; message: string };

const MODALIDAD_LABEL: Record<Modalidad, string> = {
  presencial: "Presencial",
  online: "Online",
};

const ESTADO_LABEL: Record<TurnoEstado, string> = {
  programado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
  ausente: "Ausente",
};

const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "MercadoPago",
  debito: "Débito",
  credito: "Crédito",
  otro: "Otro",
};

const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

function parseTurno(turno: TurnoJson): Turno {
  return {
    ...turno,
    fecha: new Date(turno.fecha),
    pagoFecha: turno.pagoFecha ? new Date(turno.pagoFecha) : null,
    creadoEn: new Date(turno.creadoEn),
    actualizadoEn: new Date(turno.actualizadoEn),
  };
}

function estadoChipVariant(
  estado: TurnoEstado,
): "sage" | "gold" | "terracotta" | "neutral" {
  if (estado === "realizado") return "sage";
  if (estado === "cancelado") return "terracotta";
  if (estado === "ausente") return "gold";
  return "neutral";
}

// Cobros optimistas sobre la lista recibida por props. Van atados a la
// referencia de `turnos` que los originó: cuando el padre entrega una lista
// nueva (refetch tras onTurnoActualizado) los ajustes viejos dejan de
// aplicarse solos, sin sincronizar props → estado en un efecto.
type AjustesCobro = {
  base: Turno[];
  porId: Record<string, Turno>;
};

export function TurnosPagosTab({
  turnos,
  onTurnoActualizado,
}: TurnosPagosTabProps) {
  const [ajustes, setAjustes] = React.useState<AjustesCobro | null>(null);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);
  const [toast, setToast] = React.useState<ToastState>({
    open: false,
    message: "",
  });

  const ajustesVigentes =
    ajustes && ajustes.base === turnos ? ajustes.porId : null;
  const localTurnos = React.useMemo(
    () =>
      ajustesVigentes
        ? turnos.map((turno) => ajustesVigentes[turno.id] ?? turno)
        : turnos,
    [turnos, ajustesVigentes],
  );

  function ajustarTurno(turnoId: string, turno: Turno) {
    const base = turnos;
    setAjustes((prev) => ({
      base,
      porId: {
        ...(prev && prev.base === base ? prev.porId : {}),
        [turnoId]: turno,
      },
    }));
  }

  const turnosOrdenados = React.useMemo(
    () =>
      [...localTurnos].sort(
        (a, b) => b.fecha.getTime() - a.fecha.getTime(),
      ),
    [localTurnos],
  );

  const sesionesRealizadas = React.useMemo(
    () => localTurnos.filter((turno) => turno.estado === "realizado"),
    [localTurnos],
  );
  const sesionesImpagas = React.useMemo(
    () =>
      sesionesRealizadas.filter((turno) => turno.pagoEstado === "pendiente"),
    [sesionesRealizadas],
  );
  const deudaTotal = React.useMemo(
    () => sesionesImpagas.reduce((acc, t) => acc + t.tarifaCobrada, 0),
    [sesionesImpagas],
  );

  async function cobrar(turnoId: string, metodo: MetodoPago) {
    const previous = ajustes;
    const target = localTurnos.find((t) => t.id === turnoId);
    if (!target || target.pagoEstado === "pagado") return;

    ajustarTurno(turnoId, {
      ...target,
      pagoEstado: "pagado",
      pagoFecha: new Date(),
      pagoMetodo: metodo,
    });
    setToast({ open: true, message: "Cobrado" });

    try {
      const response = await fetch(`/api/turnos/${turnoId}/cobrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo }),
      });

      if (!response.ok) {
        throw new Error("No se pudo cobrar la sesión.");
      }

      const json = (await response.json()) as TurnoResponse;
      ajustarTurno(turnoId, parseTurno(json.data));
      onTurnoActualizado?.();
    } catch {
      setAjustes(previous);
      setToast({ open: true, message: "No se pudo cobrar" });
    }
  }

  function handleMetodoCobro(metodo: MetodoPago) {
    if (!cobroTarget) return;
    const turnoId = cobroTarget.id;
    setCobroTarget(null);
    void cobrar(turnoId, metodo);
  }

  return (
    <div className="flex flex-col gap-6">
      {sesionesImpagas.length > 0 && (
        <DeudaBanner
          monto={deudaTotal}
          cantidad={sesionesImpagas.length}
        />
      )}

      <HistorialList
        turnos={turnosOrdenados}
        onCobrar={(turno) => setCobroTarget(turno)}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() =>
          setToast((current) => ({ ...current, open: false }))
        }
      />

      <Sheet
        open={cobroTarget !== null}
        onClose={() => setCobroTarget(null)}
        maxWidth={360}
        ariaLabel="Elegir método de pago"
        className="!h-auto"
      >
        {cobroTarget && (
          <MetodoPagoSelector
            monto={cobroTarget.tarifaCobrada}
            onSelect={handleMetodoCobro}
            onCancel={() => setCobroTarget(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function DeudaBanner({
  monto,
  cantidad,
}: {
  monto: number;
  cantidad: number;
}) {
  const cantidadLabel =
    cantidad === 1 ? "1 sesión sin cobrar" : `${cantidad} sesiones sin cobrar`;

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-terracotta-100 bg-terracotta-50/70 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <AlertCircle
        size={18}
        strokeWidth={1.8}
        aria-hidden="true"
        className="shrink-0 text-terracotta-500"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="font-sans text-[13px] leading-[1.45] text-ink-700">
          <span className="font-semibold text-ink-900">{cantidadLabel}</span>
          <span className="text-ink-500"> · </span>
          <span className="tabular-nums text-terracotta-500 font-display font-medium">
            {money(monto)}
          </span>
        </p>
        <p className="font-sans text-[12px] text-ink-500">
          Deuda acumulada por sesiones realizadas y pendientes de cobro.
        </p>
      </div>
      <span className="font-display text-[18px] font-medium tabular-nums text-terracotta-500 sm:text-[20px]">
        {moneyShort(monto)}
      </span>
    </div>
  );
}

function HistorialList({
  turnos,
  onCobrar,
}: {
  turnos: Turno[];
  onCobrar: (turno: Turno) => void;
}) {
  if (turnos.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white px-6 py-10 text-center">
        <p className="text-[13px] text-ink-500">
          Todavía no hay turnos registrados.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {turnos.map((turno) => (
          <TurnoRow
            key={turno.id}
            turno={turno}
            onCobrar={() => onCobrar(turno)}
          />
        ))}
      </ul>
    </div>
  );
}

function TurnoRow({
  turno,
  onCobrar,
}: {
  turno: Turno;
  onCobrar: () => void;
}) {
  const mostrarCobrar =
    turno.estado === "realizado" && turno.pagoEstado === "pendiente";
  const mostrarPagado =
    turno.estado === "realizado" && turno.pagoEstado === "pagado";

  return (
    <li>
      <div className="flex flex-col gap-3 px-5 py-[14px] lg:grid lg:grid-cols-[110px_1fr_auto_auto_auto_120px] lg:items-center lg:gap-4">
        <div className="flex flex-col">
          <span className="font-sans text-[13px] font-medium text-ink-700 tabular-nums">
            {fechaCorta(turno.fecha)}
          </span>
          <span className="font-sans text-[11px] text-ink-300 tabular-nums">
            {hora(turno.fecha)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[12px] text-ink-500">
            {turno.duracion} min
          </span>
          <Chip variant="neutral" size="sm">
            {MODALIDAD_LABEL[turno.modalidad]}
          </Chip>
        </div>

        <Chip variant={estadoChipVariant(turno.estado)} size="sm">
          {ESTADO_LABEL[turno.estado]}
        </Chip>

        <div className="flex flex-col gap-1">
          {mostrarPagado ? (
            <Chip variant="sage" size="sm">
              Pagado
            </Chip>
          ) : turno.estado === "realizado" ? (
            <Chip variant="terracotta" size="sm">
              Pendiente
            </Chip>
          ) : (
            <span className="font-sans text-[11px] text-ink-300">—</span>
          )}
          {mostrarPagado && turno.pagoMetodo && (
            <span className="font-sans text-[11px] text-ink-500">
              {METODO_PAGO_LABEL[turno.pagoMetodo]}
            </span>
          )}
        </div>

        <span className="font-sans text-[13px] text-ink-900 tabular-nums">
          {money(turno.tarifaCobrada)}
        </span>

        <div className="flex justify-end">
          <AnimatePresence mode="wait" initial={false}>
            {mostrarCobrar ? (
              <motion.button
                key="cobrar"
                type="button"
                onClick={onCobrar}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-gold-50 px-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-gold-500 transition-colors duration-150 hover:bg-gold-50/80 lg:min-h-[36px]"
              >
                Cobrar
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </li>
  );
}

function MetodoPagoSelector({
  monto,
  onSelect,
  onCancel,
}: {
  monto: number;
  onSelect: (metodo: MetodoPago) => void;
  onCancel: () => void;
}) {
  return (
    <div className="pb-2 pt-1">
      <div className="mb-5">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Cobrar sesión
        </p>
        <h2 className="mt-1 font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Elegí el método
        </h2>
        <p className="mt-1 font-sans text-[13px] text-ink-500">
          {money(monto)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {METODOS_PAGO.map((metodo) => (
          <button
            key={metodo.value}
            type="button"
            onClick={() => onSelect(metodo.value)}
            className="min-h-[44px] rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-left text-[14px] font-semibold text-ink-900 transition-colors duration-150 hover:border-sage-500 hover:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-500/20"
          >
            {metodo.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
