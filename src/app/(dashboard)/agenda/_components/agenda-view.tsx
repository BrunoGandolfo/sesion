"use client";

import * as React from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Button, Fab, Sheet, Toast } from "@/components/ui";
import { NuevoTurnoForm } from "@/components/forms";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import type { PacienteConDeuda, TurnoConPaciente } from "@/types/domain";

import { AgendaHeader } from "./agenda-header";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { TurnoDetailSheet } from "./turno-detail-sheet";

export type AgendaViewMode = "día" | "semana" | "mes";

const MOBILE_QUERY = "(max-width: 1023px)";

function subscribeMedia(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}
function getMobileServerSnapshot() {
  return false;
}

type RawTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

function parseTurno(raw: RawTurno): TurnoConPaciente {
  return {
    ...raw,
    fecha: new Date(raw.fecha),
    pagoFecha: raw.pagoFecha ? new Date(raw.pagoFecha) : null,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
  };
}

function computeRange(
  view: AgendaViewMode,
  anchor: Date,
): { desde: Date; hasta: Date } {
  if (view === "día") {
    const desde = new Date(anchor);
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(anchor);
    hasta.setHours(23, 59, 59, 999);
    return { desde, hasta };
  }
  if (view === "semana") {
    const desde = startOfWeek(anchor, { weekStartsOn: 1 });
    desde.setHours(0, 0, 0, 0);
    const hasta = endOfWeek(anchor, { weekStartsOn: 1 });
    hasta.setHours(23, 59, 59, 999);
    return { desde, hasta };
  }
  const monthStart = startOfMonth(anchor);
  const desde = startOfWeek(monthStart, { weekStartsOn: 1 });
  desde.setHours(0, 0, 0, 0);
  const hasta = addDays(desde, 41);
  hasta.setHours(23, 59, 59, 999);
  return { desde, hasta };
}

type LoadState = "idle" | "loading" | "error";

export function AgendaView() {
  const isMobile = React.useSyncExternalStore(
    subscribeMedia,
    getMobileSnapshot,
    getMobileServerSnapshot,
  );
  const [userView, setUserView] = React.useState<AgendaViewMode | null>(null);
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [detalleId, setDetalleId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ open: boolean; message: string }>(
    { open: false, message: "" },
  );
  const today = React.useMemo(() => new Date(), []);

  const view: AgendaViewMode = userView ?? (isMobile ? "día" : "semana");

  const { desde, hasta } = React.useMemo(
    () => computeRange(view, anchor),
    [view, anchor],
  );
  const rangeKey = `${desde.toISOString()}|${hasta.toISOString()}`;

  const cacheRef = React.useRef<Map<string, TurnoConPaciente[]>>(new Map());
  const [turnos, setTurnos] = React.useState<TurnoConPaciente[] | null>(null);
  const [turnosStatus, setTurnosStatus] = React.useState<LoadState>("idle");
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      setTurnos(cached);
      setTurnosStatus("idle");
      return;
    }

    const controller = new AbortController();
    setTurnosStatus("loading");

    const url =
      `/api/turnos?desde=${encodeURIComponent(desde.toISOString())}` +
      `&hasta=${encodeURIComponent(hasta.toISOString())}`;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { data: RawTurno[] };
      })
      .then((json) => {
        const parsed = json.data.map(parseTurno);
        cacheRef.current.set(rangeKey, parsed);
        setTurnos(parsed);
        setTurnosStatus("idle");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Error cargando agenda", err);
        setTurnosStatus("error");
      });

    return () => controller.abort();
  }, [rangeKey, desde, hasta, refreshKey]);

  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [pacientesStatus, setPacientesStatus] =
    React.useState<LoadState>("idle");

  const fetchPacientes = React.useCallback(() => {
    setPacientesStatus("loading");
    fetch("/api/pacientes")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { data: PacienteConDeuda[] };
      })
      .then((json) => {
        setPacientes(json.data);
        setPacientesStatus("idle");
      })
      .catch((err: unknown) => {
        console.error("Error cargando pacientes", err);
        setPacientesStatus("error");
      });
  }, []);

  const handlePrev = () => {
    setAnchor((d) => {
      if (view === "día") return addDays(d, -1);
      if (view === "semana") return addWeeks(d, -1);
      return addMonths(d, -1);
    });
  };
  const handleNext = () => {
    setAnchor((d) => {
      if (view === "día") return addDays(d, 1);
      if (view === "semana") return addWeeks(d, 1);
      return addMonths(d, 1);
    });
  };
  const handleToday = () => setAnchor(new Date());
  const handleDayClick = (day: Date) => {
    setAnchor(day);
    setUserView("día");
  };
  const handleEventClick = (turno: TurnoConPaciente) => {
    setDetalleId(turno.id);
  };

  const selectedTurno = React.useMemo(
    () => (detalleId ? (turnos ?? []).find((t) => t.id === detalleId) ?? null : null),
    [detalleId, turnos],
  );

  const closeDetalle = () => setDetalleId(null);

  const refetchTurnos = React.useCallback(() => {
    cacheRef.current.clear();
    setRefreshKey((k) => k + 1);
  }, []);

  const handleTurnoUpdated = (message: string) => {
    setDetalleId(null);
    setToast({ open: true, message });
    refetchTurnos();
  };

  const handleTurnoError = (message: string) => {
    setToast({ open: true, message });
  };

  const openSheet = () => {
    setSheetOpen(true);
    if (pacientes === null && pacientesStatus !== "loading") {
      fetchPacientes();
    }
  };
  const closeSheet = () => setSheetOpen(false);

  const handleCreateTurno = async (data: NuevoTurnoData) => {
    try {
      const fechaISO = new Date(`${data.fecha}T${data.hora}:00`).toISOString();
      const res = await fetch("/api/turnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pacienteId: data.pacienteId,
          fecha: fechaISO,
          duracion: data.duracion,
          modalidad: data.modalidad,
          notas: data.notas ? data.notas : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSheetOpen(false);
      setToast({ open: true, message: "Turno agendado" });
      cacheRef.current.clear();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Error creando turno", err);
      setToast({ open: true, message: "No se pudo agendar el turno" });
    }
  };

  const retryTurnos = () => {
    cacheRef.current.delete(rangeKey);
    setRefreshKey((k) => k + 1);
  };

  const showFullError = turnos === null && turnosStatus === "error";
  const showFullLoading = turnos === null && turnosStatus === "loading";
  const showUpdateHint = turnos !== null && turnosStatus === "loading";

  return (
    <>
      <div className="mx-auto w-full max-w-[1200px] p-5 lg:p-12">
        <AgendaHeader
          view={view}
          onViewChange={setUserView}
          anchor={anchor}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          onNewTurno={openSheet}
        />
        <div
          aria-live="polite"
          className="mt-3 h-4 text-[11px] text-ink-300"
        >
          {showUpdateHint ? "Actualizando…" : null}
        </div>
        <div className="mt-3 lg:mt-4">
          {showFullLoading ? (
            <div className="py-16 text-center text-[14px] text-ink-500">
              Cargando agenda…
            </div>
          ) : showFullError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-10 text-center">
              <p className="text-[14px] text-ink-500">
                No pudimos cargar la agenda.
              </p>
              <Button variant="secondary" size="sm" onClick={retryTurnos}>
                Reintentar
              </Button>
            </div>
          ) : turnos !== null ? (
            view === "día" ? (
              <DayView
                date={anchor}
                turnos={turnos}
                onOpenTurno={handleEventClick}
              />
            ) : view === "semana" ? (
              <>
                <div className="hidden lg:block">
                  <WeekView
                    anchor={anchor}
                    turnos={turnos}
                    today={today}
                    onEventClick={handleEventClick}
                  />
                </div>
                <div className="lg:hidden">
                  <DayView
                    date={anchor}
                    turnos={turnos}
                    onOpenTurno={handleEventClick}
                  />
                </div>
              </>
            ) : (
              <MonthView
                anchor={anchor}
                today={today}
                turnos={turnos}
                onDayClick={handleDayClick}
              />
            )
          ) : null}
        </div>
      </div>
      <Fab label="Agendar turno" onClick={openSheet} />
      <Sheet open={sheetOpen} onClose={closeSheet} ariaLabel="Agendar turno">
        {pacientesStatus === "loading" && pacientes === null ? (
          <div className="py-10 text-center text-[14px] text-ink-500">
            Cargando pacientes…
          </div>
        ) : pacientesStatus === "error" && pacientes === null ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-[14px] text-ink-500">
              No pudimos cargar los pacientes.
            </p>
            <Button variant="secondary" size="sm" onClick={fetchPacientes}>
              Reintentar
            </Button>
          </div>
        ) : pacientes !== null ? (
          <NuevoTurnoForm
            pacientes={pacientes}
            onSubmit={handleCreateTurno}
            onCancel={closeSheet}
          />
        ) : null}
      </Sheet>
      <TurnoDetailSheet
        open={detalleId !== null}
        turno={selectedTurno}
        onClose={closeDetalle}
        onUpdated={handleTurnoUpdated}
        onError={handleTurnoError}
      />
      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />
    </>
  );
}
