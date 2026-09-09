"use client";

// Turnos y pagos del paciente (sección plegada de la pestaña Ficha) y el
// sheet de cobro, que también usa la card de la sesión de hoy en Sesiones.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle } from "lucide-react";

import { Button, Chip, Confirmar, Sheet, Toast } from "@/components/ui";
import {
  CheckDibujado,
  useConfirmacionDibujada,
} from "@/components/ui/movimiento";
import { esDeudaPendiente } from "@/app/api/_lib/domain";
import { apiDelete, apiPost } from "@/lib/api-client";
import { fechaCorta, hora, money, moneyShort } from "@/lib/format";
import {
  AGENDADO,
  ALGO_FALLO,
  COBRO_DESHECHO,
  DESHACER_COBRO,
  DESHACER_COBRO_ACCION,
  DESHACER_COBRO_MENSAJE,
  DESHACER_COBRO_TITULO,
  DESHACIENDO_COBRO,
  METODOS_PAGO,
  METODO_PAGO_LABEL,
  NO_VINO,
  pluralizar,
} from "@/lib/glosario";
import type {
  MetodoPago,
  Modalidad,
  Turno,
  TurnoEstado,
} from "@/types/domain";

import { parseTurno, type TurnoJson } from "./json-ficha";

interface TurnosPagosTabProps {
  turnos: Turno[];
  onTurnoActualizado?: () => void;
}

type ToastState = { open: boolean; message: string };

const MODALIDAD_LABEL: Record<Modalidad, string> = {
  presencial: "Presencial",
  online: "Online",
};

const ESTADO_LABEL: Record<TurnoEstado, string> = {
  programado: AGENDADO,
  realizado: "Realizado",
  cancelado: "Cancelado",
  ausente: NO_VINO,
};


function estadoChipVariant(
  estado: TurnoEstado,
): "sage" | "gold" | "terracotta" | "neutral" {
  if (estado === "realizado") return "sage";
  if (estado === "cancelado") return "terracotta";
  if (estado === "ausente") return "gold";
  return "neutral";
}

/** POST /api/turnos/[id]/cobrar → turno actualizado. */
export async function cobrarTurno(
  turnoId: string,
  metodo: MetodoPago,
): Promise<Turno> {
  const json = await apiPost<TurnoJson>(`/api/turnos/${turnoId}/cobrar`, {
    metodo,
  });
  return parseTurno(json);
}

/**
 * DELETE /api/turnos/[id]/cobrar → turno actualizado.
 *
 * Deshace el último cobro: el turno vuelve a `pagoEstado: "pendiente"` y su
 * monto vuelve a la deuda. No toca el estado del turno (sigue realizado) y no
 * borra nada, así que se puede volver a cobrar enseguida.
 */
export async function deshacerCobroTurno(turnoId: string): Promise<Turno> {
  const json = await apiDelete<TurnoJson>(`/api/turnos/${turnoId}/cobrar`);
  return parseTurno(json);
}

// Cobros optimistas sobre la lista recibida por props. Van atados a la
// referencia de `turnos` que los originó: cuando el padre entrega una lista
// nueva (refetch tras onTurnoActualizado) los ajustes viejos dejan de
// aplicarse solos, sin sincronizar props → estado en un efecto.
type AjustesCobro = {
  base: Turno[];
  porId: Record<string, Turno>;
};

export function TurnosPagosTab({ turnos, onTurnoActualizado }: TurnosPagosTabProps) {
  const [ajustes, setAjustes] = React.useState<AjustesCobro | null>(null);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);
  const [toast, setToast] = React.useState<ToastState>({ open: false, message: "" });

  const ajustesVigentes = ajustes && ajustes.base === turnos ? ajustes.porId : null;
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
    () => [...localTurnos].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
    [localTurnos],
  );

  const sesionesImpagas = React.useMemo(
    () =>
      localTurnos.filter(
        esDeudaPendiente,
      ),
    [localTurnos],
  );
  const deudaTotal = React.useMemo(
    () => sesionesImpagas.reduce((acc, t) => acc + t.tarifaCobrada, 0),
    [sesionesImpagas],
  );

  return (
    <div className="flex flex-col gap-6">
      {sesionesImpagas.length > 0 && (
        <DeudaBanner monto={deudaTotal} cantidad={sesionesImpagas.length} />
      )}

      <HistorialList
        turnos={turnosOrdenados}
        onCobrar={(turno) => setCobroTarget(turno)}
        onDeshecho={(turno) => {
          ajustarTurno(turno.id, turno);
          setToast({ open: true, message: COBRO_DESHECHO });
          onTurnoActualizado?.();
        }}
        onError={(mensaje) => setToast({ open: true, message: mensaje })}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />

      <CobrarSheet
        turno={cobroTarget}
        onClose={() => setCobroTarget(null)}
        onCobrado={(turno) => {
          ajustarTurno(turno.id, turno);
          setToast({ open: true, message: "Cobrado" });
          onTurnoActualizado?.();
        }}
        onError={(mensaje) => setToast({ open: true, message: mensaje })}
      />
    </div>
  );
}

/**
 * Sheet de cobro: elige el método y hace el POST. Al confirmar avisa con el
 * turno actualizado; al fallar avisa con el mensaje y se queda abierto para
 * reintentar.
 *
 * El cierre ya no es inmediato: el check se traza sobre el método que ella
 * tocó y recién ahí el sheet se va (useConfirmacionDibujada). Antes la única
 * confirmación era el toast, abajo de todo y lejos del renglón.
 */
export function CobrarSheet({
  turno,
  onClose,
  onCobrado,
  onError,
}: {
  turno: Turno | null;
  onClose: () => void;
  onCobrado: (turno: Turno) => void;
  onError: (mensaje: string) => void;
}) {
  const [cobrando, setCobrando] = React.useState(false);
  const [confirmado, confirmar] = useConfirmacionDibujada<MetodoPago>(onClose);

  async function elegir(metodo: MetodoPago) {
    if (!turno || cobrando || confirmado) return;
    setCobrando(true);
    try {
      const actualizado = await cobrarTurno(turno.id, metodo);
      confirmar(metodo);
      onCobrado(actualizado);
    } catch (err) {
      onError(err instanceof Error ? err.message : ALGO_FALLO);
    } finally {
      setCobrando(false);
    }
  }

  return (
    <Sheet
      open={turno !== null}
      onClose={onClose}
      maxWidth={360}
      ariaLabel="Elegir método de pago"
      className="!h-auto"
    >
      {turno && (
        <MetodoPagoSelector
          monto={turno.tarifaCobrada}
          deshabilitado={cobrando || confirmado !== null}
          confirmado={confirmado}
          onSelect={(metodo) => void elegir(metodo)}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}

function DeudaBanner({ monto, cantidad }: { monto: number; cantidad: number }) {
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
          <span className="font-semibold text-ink-900">
            {pluralizar(cantidad, "sesión sin cobrar", "sesiones sin cobrar")}
          </span>
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
  onDeshecho,
  onError,
}: {
  turnos: Turno[];
  onCobrar: (turno: Turno) => void;
  onDeshecho: (turno: Turno) => void;
  onError: (mensaje: string) => void;
}) {
  if (turnos.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white px-6 py-10 text-center">
        <p className="text-[13px] text-ink-500">Todavía no hay turnos registrados.</p>
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
            onDeshecho={onDeshecho}
            onError={onError}
          />
        ))}
      </ul>
    </div>
  );
}

function TurnoRow({
  turno,
  onCobrar,
  onDeshecho,
  onError,
}: {
  turno: Turno;
  onCobrar: () => void;
  onDeshecho: (turno: Turno) => void;
  onError: (mensaje: string) => void;
}) {
  const mostrarCobrar = esDeudaPendiente(turno);
  const mostrarPagado = turno.estado === "realizado" && turno.pagoEstado === "pagado";

  // La confirmación se abre debajo de la fila, no en un sheet: es una
  // reversión, no un cobro, y no hay nada que elegir.
  const [confirmando, setConfirmando] = React.useState(false);
  const [deshaciendo, setDeshaciendo] = React.useState(false);

  async function deshacer() {
    setDeshaciendo(true);
    try {
      const actualizado = await deshacerCobroTurno(turno.id);
      setConfirmando(false);
      onDeshecho(actualizado);
    } catch (err) {
      onError(err instanceof Error ? err.message : ALGO_FALLO);
    } finally {
      setDeshaciendo(false);
    }
  }

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
          <span className="font-sans text-[12px] text-ink-500">{turno.duracion} min</span>
          <Chip variant="neutral" size="sm">
            {MODALIDAD_LABEL[turno.modalidad]}
          </Chip>
        </div>

        <Chip variant={estadoChipVariant(turno.estado)} size="sm" className="self-start justify-self-start">
          {ESTADO_LABEL[turno.estado]}
        </Chip>

        <div className="flex flex-col items-start gap-1">
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
            ) : mostrarPagado && !confirmando ? (
              <motion.button
                key="deshacer"
                type="button"
                onClick={() => setConfirmando(true)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500 transition-colors duration-150 hover:bg-cream-100 hover:text-ink-700 lg:min-h-[36px]"
              >
                {DESHACER_COBRO}
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {confirmando ? (
        <div className="px-5 pb-[14px]">
          <Confirmar
            titulo={DESHACER_COBRO_TITULO}
            mensaje={DESHACER_COBRO_MENSAJE}
            accion={DESHACER_COBRO_ACCION}
            cancelar="Volver"
            enviando={deshaciendo}
            enviandoLabel={DESHACIENDO_COBRO}
            onConfirmar={() => void deshacer()}
            onCancelar={() => setConfirmando(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

function MetodoPagoSelector({
  monto,
  deshabilitado,
  confirmado,
  onSelect,
  onCancel,
}: {
  monto: number;
  deshabilitado: boolean;
  /** Método ya cobrado, mientras se dibuja el check sobre su botón. */
  confirmado: MetodoPago | null;
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
        <p className="mt-1 font-sans text-[13px] text-ink-500">{money(monto)}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {METODOS_PAGO.map((metodo) => (
          <button
            key={metodo.value}
            type="button"
            disabled={deshabilitado}
            onClick={() => onSelect(metodo.value)}
            className={`flex min-h-[44px] items-center justify-between gap-3 rounded-md border bg-cream-50 px-4 py-3 text-left text-[14px] font-semibold text-ink-900 transition-colors duration-150 hover:border-sage-500 hover:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-500/20 disabled:opacity-60 ${
              confirmado === metodo.value
                ? "border-sage-500 bg-white !opacity-100"
                : "border-[color:var(--border-subtle)]"
            }`}
          >
            <span>{metodo.label}</span>
            {confirmado === metodo.value ? (
              <CheckDibujado tamano={18} className="shrink-0 text-sage-600" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={deshabilitado}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
