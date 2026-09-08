"use client";

import * as React from "react";
import type { TurnoConPaciente } from "@/types/domain";
import { esMismoDiaMvd } from "@/lib/fechas-montevideo";
import { hora, money } from "@/lib/format";
import {
  AGENDADO,
  CANCELADO,
  COBRAR,
  FALTA_AUTORIZACION,
  GRABAR_SESION,
  NO_VINO,
  PAGADO,
  PENDIENTE,
  REVISAR_NOTA,
} from "@/lib/glosario";
import { Avatar } from "./avatar";
import { Chip } from "./chip";

interface SessionRowProps {
  turno: TurnoConPaciente;
  onClick?: () => void;
  onCobrar?: () => void;
  /** Momento actual. Con él la fila sabe si la hora del turno ya pasó; sin
   *  él cae en la regla vieja (cobrable solo si el turno está "realizado"). */
  ahora?: Date;
  /** El turno tiene una nota generada esperando aprobación. */
  notaParaRevisar?: boolean;
  /** La paciente no firmó la autorización para grabar. */
  sinAutorizacion?: boolean;
  onRevisarNota?: () => void;
  onGrabar?: () => void;
  onAutorizar?: () => void;
  className?: string;
}

type Status = {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
};

/** Acción única de la fila. La decide el estado del turno, no la pantalla:
 *  la misma fila en la agenda y en Hoy ofrece lo mismo. */
type Accion = {
  label: string;
  tono: "gold" | "terracotta";
  onClick: () => void;
};

function statusFor(turno: TurnoConPaciente): Status {
  if (turno.estado === "cancelado") return { variant: "neutral", label: CANCELADO };
  if (turno.estado === "ausente") return { variant: "neutral", label: NO_VINO };
  if (turno.pagoEstado === "pagado") return { variant: "sage", label: PAGADO };
  if (turno.estado === "programado") return { variant: "gold", label: AGENDADO };
  return { variant: "terracotta", label: PENDIENTE };
}

function borderLeftClass(turno: TurnoConPaciente): string {
  if (turno.estado === "cancelado") return "border-l-ink-300";
  if (turno.pagoEstado === "pagado") return "border-l-sage-500";
  if (turno.estado === "programado") return "border-l-gold-500";
  if (turno.estado === "realizado") return "border-l-terracotta-500";
  return "border-l-ink-300";
}

/**
 * Se puede grabar mientras el turno siga vivo —programado o realizado— y sea
 * del día de hoy en Montevideo (no en la zona del dispositivo: una sesión de
 * las 21:30 es de hoy aunque el reloj UTC ya diga mañana).
 *
 * La hora del turno no entra en la cuenta. Antes la fila escondía "Grabar
 * sesión" apenas pasaba la hora, y una sesión que empezó diez minutos tarde
 * quedaba sin botón para grabarla —mientras la API y el FAB de la ficha la
 * dejaban grabar igual. El límite real es el día: grabar el turno de ayer no
 * es grabar una sesión, es otra cosa.
 */
export function puedeGrabarseHoy(
  turno: Pick<TurnoConPaciente, "estado" | "fecha">,
  ahora: Date,
): boolean {
  if (turno.estado !== "programado" && turno.estado !== "realizado") return false;
  return esMismoDiaMvd(turno.fecha, ahora);
}

/**
 * Orden de precedencia, el mismo que la card de Ahora: sin autorización no
 * se graba; una nota escrita se revisa antes que nada; una sesión cuya hora
 * ya pasó y sigue impaga se cobra —aunque el turno todavía figure como
 * programado, porque el caso de uso de cobrar lo marca realizado—; y si no
 * hay cobro pendiente, se graba. Sin handler, la fila muestra el chip de
 * estado.
 */
function accionDe({
  turno,
  ahora,
  notaParaRevisar,
  sinAutorizacion,
  onCobrar,
  onRevisarNota,
  onGrabar,
  onAutorizar,
}: SessionRowProps): Accion | null {
  if (turno.estado === "cancelado" || turno.estado === "ausente") return null;

  if (sinAutorizacion && onAutorizar) {
    return {
      label: `${FALTA_AUTORIZACION} →`,
      tono: "terracotta",
      onClick: onAutorizar,
    };
  }

  if (notaParaRevisar && onRevisarNota) {
    return { label: REVISAR_NOTA, tono: "gold", onClick: onRevisarNota };
  }

  const horaPasada = ahora
    ? turno.fecha.getTime() <= ahora.getTime()
    : turno.estado === "realizado";

  if (horaPasada && turno.pagoEstado === "pendiente" && onCobrar) {
    return { label: COBRAR, tono: "gold", onClick: onCobrar };
  }

  // Sin `ahora` no se puede saber si el turno es de hoy: se conserva la regla
  // vieja (se graba lo que todavía figura como programado).
  const puedeGrabar = ahora
    ? puedeGrabarseHoy(turno, ahora)
    : turno.estado === "programado";

  if (puedeGrabar && onGrabar) {
    return { label: GRABAR_SESION, tono: "gold", onClick: onGrabar };
  }

  return null;
}

const TONO: Record<Accion["tono"], string> = {
  gold: "bg-gold-50 text-gold-500 group-hover:bg-gold-500/10",
  terracotta:
    "bg-terracotta-50 text-terracotta-600 group-hover:bg-terracotta-500/10",
};

export function SessionRow(props: SessionRowProps) {
  const { turno, onClick, className = "" } = props;
  const status = statusFor(turno);
  const leftClass = borderLeftClass(turno);
  const accion = accionDe(props);

  const base = `w-full flex items-center gap-4 bg-white border border-[color:var(--border-subtle)] rounded-md pl-[13px] pr-4 py-[14px] text-left transition-colors duration-150 border-l-[3px] ${leftClass} hover:bg-cream-50 hover:border-l-sage-300 ${className}`;

  const content = (
    <>
      <div className="flex flex-col shrink-0 min-w-[52px]">
        <span className="font-display text-[19px] font-medium tabular-nums leading-none text-ink-900">
          {hora(turno.fecha)}
        </span>
        <span className="text-[11px] text-ink-300 mt-1">
          {turno.duracion} min
        </span>
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Avatar
          nombre={turno.paciente.nombre}
          apellido={turno.paciente.apellido}
          size={28}
        />
        <div className="flex flex-col min-w-0">
          <span className="text-[15px] font-semibold text-ink-900 truncate">
            {turno.paciente.nombre} {turno.paciente.apellido}
          </span>
          <span className="text-[12px] text-ink-500 truncate">
            {turno.modalidad === "online" ? "Online" : "Presencial"} ·{" "}
            {money(turno.tarifaCobrada)}
          </span>
        </div>
      </div>

      <div className="flex items-center shrink-0">
        {accion ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              accion.onClick();
            }}
            className="group inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-1"
          >
            <span
              className={`rounded-full px-[10px] py-[3px] text-[12px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors duration-150 ${TONO[accion.tono]}`}
            >
              {accion.label}
            </span>
          </button>
        ) : (
          <Chip variant={status.variant}>{status.label}</Chip>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {content}
      </button>
    );
  }

  return <div className={base}>{content}</div>;
}
