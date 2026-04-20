"use client";

import * as React from "react";
import type { TurnoConPaciente } from "@/types/domain";
import { hora, money } from "@/lib/format";
import { Avatar } from "./avatar";
import { Chip } from "./chip";

interface SessionRowProps {
  turno: TurnoConPaciente;
  onClick?: () => void;
  onCobrar?: () => void;
  className?: string;
}

type Status = {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
};

function statusFor(turno: TurnoConPaciente): Status {
  if (turno.estado === "cancelado") return { variant: "neutral", label: "Cancelado" };
  if (turno.estado === "ausente") return { variant: "neutral", label: "Ausente" };
  if (turno.pagoEstado === "pagado") return { variant: "sage", label: "Pagado" };
  if (turno.estado === "programado") return { variant: "gold", label: "Programado" };
  return { variant: "terracotta", label: "Pendiente" };
}

function borderLeftClass(turno: TurnoConPaciente): string {
  if (turno.estado === "cancelado") return "border-l-ink-300";
  if (turno.pagoEstado === "pagado") return "border-l-sage-500";
  if (turno.estado === "programado") return "border-l-gold-500";
  if (turno.estado === "realizado") return "border-l-terracotta-500";
  return "border-l-ink-300";
}

export function SessionRow({
  turno,
  onClick,
  onCobrar,
  className = "",
}: SessionRowProps) {
  const status = statusFor(turno);
  const leftClass = borderLeftClass(turno);
  const cobrable =
    turno.estado === "realizado" && turno.pagoEstado === "pendiente";

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
        {cobrable && onCobrar ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCobrar();
            }}
            className="group inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-1"
          >
            <span className="bg-gold-50 text-gold-500 rounded-full px-[10px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] group-hover:bg-gold-500/10 transition-colors duration-150">
              Cobrar
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
