"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { TurnoConPaciente } from "@/types/domain";
import {
  esDeudaPendiente,
  sePuedeCobrar,
  sePuedeGrabar,
} from "@/app/api/_lib/domain";
import { hora, money } from "@/lib/format";
import { esGrabacionSinTerminar } from "@/lib/sesion-clinica/estados";
import {
  AGENDADO,
  CANCELADO,
  COBRAR,
  FALTA_AUTORIZACION,
  GRABACION_SIN_TERMINAR,
  GRABAR_SESION,
  NO_VINO,
  NOTA_FALLIDA,
  NOTA_LISTA,
  NOTA_PROCESANDO,
  PAGADO,
  PARA_REVISAR,
  PENDIENTE,
  VER_QUE_PASO,
  VER_TURNO,
} from "@/lib/glosario";
import { Avatar } from "./avatar";
import { Chip } from "./chip";
import { CheckDibujado } from "./movimiento";

interface SessionRowProps {
  turno: TurnoConPaciente;
  /** Abre el detalle del turno (Agenda: reprogramar, cancelar, cobrar). No
   *  es el cuerpo de la fila —el cuerpo siempre lleva a la ficha de la
   *  paciente—: se ofrece como un control aparte, "Ver turno", a la derecha. */
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
   * acaba de tocar.
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

/** Acciones de la fila. Las decide el estado del turno, no la pantalla:
 *  la misma fila en la agenda y en Hoy ofrece lo mismo. */
type Accion = {
  tipo: "cobrar" | "autorizar" | "grabar";
  label: string;
  tono: "gold" | "terracotta";
  onClick: () => void;
};

/** Alias viejo de "procesando" que todavía llega en filas antiguas. */
const ESTADOS_PROCESANDO: ReadonlyArray<string> = ["procesando", "transcribiendo"];

/**
 * El estado clínico del turno, separado del pago. Son dos cosas distintas y
 * se dicen por separado: una nota que FALLÓ se veía en su fila sólo como
 * "Cobrar", y la deuda tapaba el problema clínico. Cada rótulo lleva a la
 * sesión; el de la fallida, además, se pinta como problema.
 */
export function estadoClinicoDe(
  sesion: { id: string; estado?: string } | null,
): { rotulo: string; sesionId: string; fallida: boolean } | null {
  if (!sesion) return null;
  if (sesion.estado === "fallida") {
    return { rotulo: `${NOTA_FALLIDA} · ${VER_QUE_PASO}`, sesionId: sesion.id, fallida: true };
  }
  if (sesion.estado === "revision") return { rotulo: PARA_REVISAR, sesionId: sesion.id, fallida: false };
  if (sesion.estado === "aprobada") return { rotulo: NOTA_LISTA, sesionId: sesion.id, fallida: false };
  return null;
}

/** Ocultan "Grabar sesión": el audio ya salió del navegador y el pipeline
 *  siguió, así que volver a grabar pisaría la nota. En "grabando" y
 *  "subiendo" la grabación quedó a medias y GrabarView.asegurarSesion sabe
 *  retomarla. */
const ESTADOS_PASADA_LA_GRABACION: ReadonlyArray<string> = [
  ...ESTADOS_PROCESANDO,
  "revision",
  "aprobada",
];

function statusFor(turno: TurnoConPaciente): Status {
  if (turno.estado === "cancelado") return { variant: "neutral", label: CANCELADO };
  if (turno.estado === "ausente") return { variant: "neutral", label: NO_VINO };
  if (turno.pagoEstado === "pagado") return { variant: "sage", label: PAGADO };
  if (turno.estado === "programado") return { variant: "neutral", label: AGENDADO };
  return { variant: "terracotta", label: PENDIENTE };
}


/**
 * Grabar y cobrar son independientes. Antes, pasada la hora con el pago
 * pendiente, la única acción era Cobrar y Grabar desaparecía: una sesión que
 * empezó cinco minutos tarde quedaba sin botón para grabarla. Ahora:
 *
 * - Grabar se ofrece mientras el turno sea de hoy y su grabación no haya
 *   salido del navegador, pase la hora que pase. Sin autorización firmada, en
 *   su lugar va el aviso "Falta autorización".
 * - Cobrar se ofrece además, no en lugar de, cuando la hora pasó y el pago
 *   sigue pendiente —aunque el turno todavía figure como programado, porque
 *   el caso de uso de cobrar lo marca realizado—. No depende de la firma: una
 *   sesión que no se grabó se cobra igual, y el aviso de la firma va al lado.
 *
 * Sin handler no hay acción; sin ninguna acción la fila muestra el chip de
 * estado. El acceso a la nota se muestra por separado, siempre.
 */
export function accionesDe({
  turno,
  ahora,
  sinAutorizacion,
  onCobrar,
  onGrabar,
  onAutorizar,
}: SessionRowProps): Accion[] {
  if (turno.estado === "cancelado" || turno.estado === "ausente") return [];

  // Las dos reglas son las del servidor (sePuedeCobrar, sePuedeGrabar de
  // domain.ts): la fila no ofrece nada que la API vaya a rechazar. Sin
  // `ahora` no se sabe si la hora llegó ni si el turno es de hoy: se cobra
  // solo lo ya realizado y no se ofrece grabar.
  const cobrable =
    (ahora ? sePuedeCobrar(turno, ahora) : esDeudaPendiente(turno)) && !!onCobrar;
  const puedeGrabar = ahora ? sePuedeGrabar(turno, ahora) : false;
  const estadoSesion = turno.sesionClinica?.estado;
  const yaPasoLaGrabacion =
    estadoSesion !== undefined &&
    ESTADOS_PASADA_LA_GRABACION.includes(estadoSesion);
  const grabable = puedeGrabar && !yaPasoLaGrabacion;

  const acciones: Accion[] = [];
  // La firma que falta se avisa donde iría Grabar, y al lado de Cobrar: no
  // lo reemplaza ni lo esconde.
  if (sinAutorizacion && onAutorizar) {
    acciones.push({
      tipo: "autorizar",
      label: `${FALTA_AUTORIZACION} →`,
      tono: "terracotta",
      onClick: onAutorizar,
    });
  } else if (grabable && onGrabar) {
    acciones.push({ tipo: "grabar", label: GRABAR_SESION, tono: "gold", onClick: onGrabar });
  }
  if (cobrable && onCobrar) {
    acciones.push({ tipo: "cobrar", label: COBRAR, tono: "gold", onClick: onCobrar });
  }
  return acciones;
}

const TONO: Record<Accion["tono"], string> = {
  gold: "bg-gold-50 text-gold-500 group-hover:bg-gold-500/10",
  terracotta:
    "bg-terracotta-50 text-terracotta-600 group-hover:bg-terracotta-500/10",
};

export function SessionRow(props: SessionRowProps) {
  const { turno, onClick, cobroConfirmado = false, className = "" } = props;
  const status = statusFor(turno);
  const leftClass = "border-l-cream-200";
  const acciones = accionesDe(props);
  const sesion = turno.sesionClinica;
  const nota = estadoClinicoDe(sesion);
  const procesando = sesion && ESTADOS_PROCESANDO.includes(sesion.estado);
  // Grabación o subida que quedó a medias (esGrabacionSinTerminar): no se
  // está procesando. Lleva a la pantalla de grabar, que ofrece la copia guardada en
  // el teléfono. Sin `ahora` (Agenda) vale el reloj del navegador.
  const sinTerminar = esGrabacionSinTerminar(sesion, props.ahora ?? new Date());
  const nombre = `${turno.paciente.nombre} ${turno.paciente.apellido}`;

  const base = `w-full flex flex-wrap items-center gap-3 bg-white border border-[color:var(--border-subtle)] rounded-md pl-[13px] pr-4 py-[14px] text-left transition-colors duration-[var(--duration-fast)] border-l-[3px] ${leftClass} hover:bg-cream-50 hover:border-l-sage-300 ${className}`;

  return (
    <div className={base}>
      {/* El cuerpo de la fila es la paciente: tocarlo lleva a su ficha, en
          Hoy y en Agenda. "Paciente estático no sirve para nada". */}
      <Link
        href={`/pacientes/${turno.paciente.id}`}
        className="flex min-h-11 min-w-0 flex-1 basis-full sm:basis-[240px] items-center gap-4 rounded-md text-left"
      >
        <div className="flex flex-col shrink-0 min-w-[52px]">
          <span className="text-[19px] font-medium tabular-nums leading-none text-ink-900">
            {hora(turno.fecha)}
          </span>
          <span className="tabular-nums text-[12px] text-ink-500 mt-1">
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
            <span className="text-[15px] font-semibold text-ink-900 break-words">
              {nombre}
            </span>
            <span className="tabular-nums text-[12px] text-ink-500">
              {turno.modalidad === "online" ? "Online" : "Presencial"} ·{" "}
              {money(turno.tarifaCobrada)}
            </span>
          </div>
        </div>
      </Link>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {nota ? (
          <Link
            href={`/sesiones/${nota.sesionId}`}
            className={`inline-flex min-h-11 items-center rounded-md px-2 text-[13px] font-semibold ${
              nota.fallida
                ? "text-terracotta-600 hover:bg-terracotta-50"
                : "text-sage-700 hover:bg-sage-50"
            }`}
          >
            {nota.rotulo}
          </Link>
        ) : sinTerminar ? (
          <Link
            href={`/grabar/${turno.id}`}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-[13px] font-semibold text-terracotta-600 hover:bg-terracotta-50"
          >
            {GRABACION_SIN_TERMINAR}
          </Link>
        ) : procesando ? (
          <span className="text-[13px] text-ink-500" role="status">{NOTA_PROCESANDO}</span>
        ) : null}
        {acciones.map((accion) =>
          accion.tipo === "cobrar" && cobroConfirmado ? (
            // Ocupa el lugar del botón, no se agrega al lado: la marca aparece
            // donde estaba "Cobrar", que es donde ella tocó.
            <span
              key={accion.tipo}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-sage-600"
            >
              <CheckDibujado tamano={20} />
            </span>
          ) : (
            <BotonAccion key={accion.tipo} accion={accion} />
          ),
        )}
        {cobroConfirmado && !acciones.some((a) => a.tipo === "cobrar") ? (
          // El turno ya figura pagado y Cobrar se fue: la marca queda sola,
          // en el mismo lugar.
          <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-sage-600">
            <CheckDibujado tamano={20} />
          </span>
        ) : acciones.length === 0 ? (
          <Chip variant={status.variant}>{status.label}</Chip>
        ) : null}
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-cream-100 hover:text-ink-900"
          >
            <span className="sr-only">
              {VER_TURNO} de {nombre}
            </span>
            <ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BotonAccion({ accion }: { accion: Accion }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        accion.onClick();
      }}
      className="group inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-1"
    >
      <span
        className={`rounded-full px-[10px] py-[3px] text-[12px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors duration-[var(--duration-fast)] ${TONO[accion.tono]}`}
      >
        {accion.label}
      </span>
    </button>
  );
}
