"use client";

// Lo que el detalle del turno muestra en modo "ver": los datos (duración,
// tarifa, pago, notas, recordatorio) y los botones de las acciones que
// tienen sentido para su estado. Qué se ofrece lo decide accionesDelDetalle
// (detalle-datos.ts); acá solo se dibuja.

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Mic } from "lucide-react";

import { Button } from "@/components/ui";
import { estadoClinicoDe } from "@/components/ui/session-row";
import { fechaCorta, hora, money } from "@/lib/format";
import {
  CANCELAR_SERIE,
  COBRAR,
  DESHACER_COBRO,
  GRABACION_SIN_TERMINAR,
  GRABAR_SESION,
  MODALIDAD_LABEL,
  NO_VINO,
  NOTA_PROCESANDO,
  RECORDATORIO,
  RECORDATORIO_ESTADO,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import type { AccionesDelDetalle, RecordatorioJson } from "./detalle-datos";

/** Los modos del detalle a los que se entra desde un botón de "ver". */
export type ModoDesdeVer =
  | "cobrar"
  | "confirmar-no-vino"
  | "confirmar-cancelar"
  | "confirmar-cancelar-serie"
  | "confirmar-deshacer-cobro";

export function DatosDelTurno({
  turno,
  aviso,
}: {
  turno: TurnoConPaciente;
  aviso: RecordatorioJson | null;
}) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[color:var(--border-subtle)] pt-4">
        <Dato etiqueta="Duración">{turno.duracion} min</Dato>
        <Dato etiqueta="Modalidad">
          {MODALIDAD_LABEL[turno.modalidad]}
        </Dato>
        <Dato etiqueta="Tarifa">
          <span className="tabular-nums">{money(turno.tarifaCobrada)}</span>
        </Dato>
        <Dato etiqueta="Pago">
          {turno.pagoEstado === "pagado"
            ? `Cobrado${turno.pagoFecha ? ` el ${fechaCorta(turno.pagoFecha)}` : ""}`
            : "Sin cobrar"}
        </Dato>
      </dl>

      {turno.notas ? (
        <div className="border-t border-[color:var(--border-subtle)] pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Notas
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink-700">
            {turno.notas}
          </p>
        </div>
      ) : null}

      {aviso ? (
        <div className="border-t border-[color:var(--border-subtle)] pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {RECORDATORIO}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`text-[14px] ${
                aviso.estado === "fallido"
                  ? "text-terracotta-600"
                  : "text-ink-900"
              }`}
            >
              {RECORDATORIO_ESTADO[aviso.estado] ?? aviso.estado}
            </span>
            <span className="text-[13px] tabular-nums text-ink-500">
              ·{" "}
              {aviso.aceptadoEn
                ? `${fechaCorta(new Date(aviso.aceptadoEn))} ${hora(new Date(aviso.aceptadoEn))}`
                : `${fechaCorta(new Date(aviso.programadoEn))} ${hora(new Date(aviso.programadoEn))}`}
            </span>
          </div>
          {aviso.motivoNoEnvio ? <p className="mt-2 text-[13px] text-ink-700">{aviso.motivoNoEnvio}</p> : null}
        </div>
      ) : null}

      {turno.estado === "cancelado" ? (
        <p className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
          Este turno fue cancelado.
        </p>
      ) : null}

      {turno.estado === "ausente" ? (
        <p className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-[13px] text-ink-500">
          La paciente no vino a este turno.
        </p>
      ) : null}

    </>
  );
}

export function AccionesDelTurno({
  turno,
  acciones,
  enviando,
  onModo,
  onReprogramar,
}: {
  turno: TurnoConPaciente;
  acciones: AccionesDelDetalle;
  enviando: boolean;
  onModo: (modo: ModoDesdeVer) => void;
  onReprogramar: () => void;
}) {
  if (!acciones.puedeGrabarORevisar) return null;
  const { clinica } = acciones;
  // El estado clínico, con las mismas palabras que la fila de Hoy y de
  // Agenda (estadoClinicoDe): "Nota fallida · Ver qué pasó", "Para revisar",
  // "Nota lista". Antes cualquier sesión, fallida incluida, ofrecía "Revisar
  // nota", y una nota que no se pudo escribir parecía una nota para leer.
  const notaClinica = estadoClinicoDe(acciones.sesion ?? null);

  return (
    <div className="flex flex-col gap-2 border-t border-[color:var(--border-subtle)] pt-5">
      {acciones.puedeCobrar ? (
        <Button
          onClick={() => onModo("cobrar")}
          disabled={enviando}
        >
          {COBRAR}
        </Button>
      ) : null}

      {acciones.puedeDeshacerCobro ? (
        <Button
          variant="ghost"
          onClick={() => onModo("confirmar-deshacer-cobro")}
          disabled={enviando}
        >
          {DESHACER_COBRO}
        </Button>
      ) : null}

      {notaClinica ? (
        <Button
          asChild
          variant="secondary"
          className={notaClinica.fallida ? "!text-terracotta-600" : undefined}
        >
          <Link href={`/sesiones/${notaClinica.sesionId}`}>
            {notaClinica.rotulo}
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </Button>
      ) : clinica.tipo === "grabar" && clinica.retomar ? (
        <Button asChild variant="secondary" className="!text-terracotta-600">
          <Link href={`/grabar/${turno.id}`}>
            {GRABACION_SIN_TERMINAR}
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </Button>
      ) : clinica.tipo === "escribiendo" ? (
        <p className="text-[13px] text-ink-500" role="status">
          {NOTA_PROCESANDO}
        </p>
      ) : clinica.tipo !== "grabar" ? null : (
        <Button asChild variant="secondary">
          <Link href={`/grabar/${turno.id}`}>
            <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
            {GRABAR_SESION}
          </Link>
        </Button>
      )}

      {acciones.esProgramado ? (
        <>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onReprogramar}
              disabled={enviando}
            >
              Reprogramar
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => onModo("confirmar-no-vino")}
              disabled={enviando}
            >
              {NO_VINO}
            </Button>
          </div>
          <Button
            variant="ghost"
            className="!text-terracotta-600 hover:!bg-terracotta-50"
            onClick={() => onModo("confirmar-cancelar")}
            disabled={enviando}
          >
            Cancelar turno
          </Button>
          {turno.serieId ? (
            <Button
              variant="ghost"
              className="!text-terracotta-600 hover:!bg-terracotta-50"
              onClick={() => onModo("confirmar-cancelar-serie")}
              disabled={enviando}
            >
              {CANCELAR_SERIE}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {etiqueta}
      </dt>
      <dd className="mt-1 text-[14px] text-ink-900">{children}</dd>
    </div>
  );
}
