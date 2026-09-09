"use client";

import { AccesoConsultorio } from "@/components/layout/cabecera-usuario";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, endOfWeek, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";

import { Button, Segmented } from "@/components/ui";
import { fechaCorta, fechaLarga } from "@/lib/format";
import { AGENDAR, NAV } from "@/lib/glosario";
import type { AgendaViewMode } from "./agenda-view";

interface Props {
  view: AgendaViewMode;
  onViewChange: (v: AgendaViewMode) => void;
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewTurno: () => void;
  /** Mobile: el mes vive detrás del título de la fecha. */
  mesAbierto: boolean;
  onToggleMes: () => void;
}

const VIEW_OPTIONS: { value: AgendaViewMode; label: string }[] = [
  { value: "día", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
];

function rangeLabelFor(view: AgendaViewMode, anchor: Date): string {
  if (view === "día") return fechaLarga(anchor);
  if (view === "semana") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return `${fechaCorta(start)} — ${fechaCorta(end)}`;
  }
  return format(anchor, "MMMM yyyy", { locale: es });
}

export function AgendaHeader({
  view,
  onViewChange,
  anchor,
  onPrev,
  onNext,
  onToday,
  onNewTurno,
  mesAbierto,
  onToggleMes,
}: Props) {
  const labelDesktop = rangeLabelFor(view, anchor);
  // En mobile siempre se ve un día (la semana se dibuja como día), así que
  // el título es la fecha larga y abre o cierra el mes.
  const labelMobile = fechaLarga(anchor);

  return (
    <header>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[30px] font-medium leading-none text-ink-900">
          {NAV.AGENDA}
        </h1>
        <AccesoConsultorio />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrev}
              aria-label="Anterior"
              icon={<ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />}
            />
            <Button variant="secondary" size="sm" onClick={onToday}>
              Hoy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              aria-label="Siguiente"
              icon={<ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />}
            />
          </div>

          {/* Mobile: la fecha es un botón que despliega el mes debajo. */}
          <button
            type="button"
            onClick={onToggleMes}
            aria-expanded={mesAbierto}
            aria-controls="agenda-mes-mobile"
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1 py-1 text-left lg:hidden"
          >
            {/* Sin `truncate`: era el único lugar donde se dice qué día se
                está mirando y decía "lunes 7 de septiem…". Envuelve en dos
                renglones antes que recortarse
                (docs/diseno/01-auditoria-frontend.md, sección 2). */}
            <span className="min-w-0 font-[family-name:var(--font-display)] text-[16px] font-medium leading-tight text-ink-900">
              {labelMobile}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`shrink-0 text-ink-500 transition-transform duration-150 ${
                mesAbierto ? "rotate-180" : ""
              }`}
            />
          </button>

          <span className="hidden whitespace-nowrap font-[family-name:var(--font-display)] text-[20px] font-medium leading-none text-ink-900 lg:inline">
            {labelDesktop}
          </span>
        </div>

        <div className="hidden items-center gap-2 lg:ml-auto lg:flex">
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={onViewChange}
            ariaLabel="Modo de vista"
          />
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
            onClick={onNewTurno}
          >
            {AGENDAR}
          </Button>
        </div>
      </div>
    </header>
  );
}
