"use client";

import * as React from "react";
import Link from "next/link";
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
  VER_NOTA,
  NOTA_PROCESANDO,
} from "@/lib/glosario";
import { Avatar } from "./avatar";
import { Chip } from "./chip";
import { CheckDibujado } from "./movimiento";

interface SessionRowProps {
  turno: TurnoConPaciente;
  onClick?: () => void;
  onCobrar?: () => void;
  /** Momento actual. Con él la fila sabe si la hora del turno ya pasó; sin
   *  él cae en la regla vieja (cobrable solo si el turno está "realizado"). */
  ahora?: Date;
  /** @deprecated El estado de nota se lee de turno.sesionClinica. */
  notaParaRevisar?: boolean;
  /** La paciente no firmó la autorización para grabar. */
  sinAutorizacion?: boolean;
  /** @deprecated El acceso a la nota usa el ID de turno.sesionClinica. */
  onRevisarNota?: () => void;
  onGrabar?: () => void;
  onAutorizar?: () => void;
  /**
   * El cobro de esta fila acaba de entrar y todavía se está confirmando.
   *
   * Quien lo pone es la pantalla que abrió el sheet del método de pago,
   * mientras dura el respiro de `useConfirmacionDibujada`: el sheet se cierra
   * y la fila que originó el cobro queda con su marca, en vez de cambiar de
   * chip sin que nada diga que ese cambio es consecuencia de lo que ella
   * acaba de tocar (docs/diseno/03-plan-de-movimiento.md, D9).
   *
   * No agrega tiempo: ocurre mientras el sheet se va. Con movimiento
   * reducido el chip cambia sin trazo, porque el trazo lo dibuja
   * `CheckDibujado`, que ya consulta la preferencia.
   */
  cobroConfirmado?: boolean;
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

/** Alias viejo de "procesando" que todavía llega en filas antiguas. */
const ESTADOS_PROCESANDO: ReadonlyArray<string> = ["procesando", "transcribiendo"];

/** Ocultan "Grabar sesión": el audio ya salió del navegador y el pipeline
 *  siguió, así que volver a grabar pisaría la nota. En "pendiente",
 *  "grabando", "subiendo" y "error" la grabación quedó a medias y
 *  GrabarView.asegurarSesion sabe retomarla. */
const ESTADOS_PASADA_LA_GRABACION: ReadonlyArray<string> = [
  ...ESTADOS_PROCESANDO,
  "revision",
  "aprobado",
];

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
 * se graba; una sesión cuya hora
 * ya pasó y sigue impaga se cobra —aunque el turno todavía figure como
 * programado, porque el caso de uso de cobrar lo marca realizado—; y si no
 * hay cobro pendiente, se graba. Sin handler, la fila muestra el chip de
 * estado. El acceso a la nota se muestra por separado, siempre.
 */
function accionDe({
  turno,
  ahora,
  sinAutorizacion,
  onCobrar,
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

  const estadoSesion = turno.sesionClinica?.estado;
  const yaPasoLaGrabacion =
    estadoSesion !== undefined &&
    ESTADOS_PASADA_LA_GRABACION.includes(estadoSesion);

  if (!yaPasoLaGrabacion && puedeGrabar && onGrabar) {
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
  const { turno, onClick, cobroConfirmado = false, className = "" } = props;
  const status = statusFor(turno);
  const leftClass = borderLeftClass(turno);
  const accion = accionDe(props);
  const sesion = turno.sesionClinica;
  const nota = sesion?.estado === "revision" ? REVISAR_NOTA
    : sesion?.estado === "aprobado" ? VER_NOTA : null;
  const procesando = sesion && ESTADOS_PROCESANDO.includes(sesion.estado);

  const base = `w-full flex flex-wrap items-center gap-3 bg-white border border-[color:var(--border-subtle)] rounded-md pl-[13px] pr-4 py-[14px] text-left transition-colors duration-150 border-l-[3px] ${leftClass} hover:bg-cream-50 hover:border-l-sage-300 ${className}`;

  const content = (
    <>
      <div className="flex flex-col shrink-0 min-w-[52px]">
        <span className="font-display text-[19px] font-medium tabular-nums leading-none text-ink-900">
          {hora(turno.fecha)}
        </span>
        <span className="text-[12px] text-ink-500 mt-1">
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

    </>
  );

  return (
    <div className={base}>
      {onClick ? (
        <button type="button" onClick={onClick} className="flex min-h-11 min-w-0 flex-1 basis-[180px] items-center gap-4 text-left">
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 basis-[180px] items-center gap-4">{content}</div>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {nota && sesion ? (
          <Link href={`/sesiones/${sesion.id}`} className="inline-flex min-h-11 items-center rounded-md px-2 text-[13px] font-semibold text-sage-700 hover:bg-sage-50">
            {nota}
          </Link>
        ) : procesando ? (
          <span className="text-[13px] text-ink-500" role="status">{NOTA_PROCESANDO}</span>
        ) : null}
        <div className="flex items-center shrink-0">
          {cobroConfirmado ? (
            // Ocupa el lugar del botón, no se agrega al lado: la marca aparece
            // donde estaba "Cobrar", que es donde ella tocó.
            <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-sage-600">
              <CheckDibujado tamano={20} />
            </span>
          ) : accion ? (
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
    </div>
    </div>
  );
}
