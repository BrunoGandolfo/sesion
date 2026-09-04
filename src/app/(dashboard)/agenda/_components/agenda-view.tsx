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
import { CalendarX2 } from "lucide-react";

import { Fab, Sheet, Toast } from "@/components/ui";
import { useHoy } from "@/hooks/useHoy";
import { ApiClientError, apiGet, apiPost, esAbort } from "@/lib/api-client";
import { ALGO_FALLO } from "@/lib/glosario";
import type {
  Configuracion,
  PacienteConDeuda,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";

import { AgendaHeader } from "./agenda-header";
import { DayView, EstadoVacio } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { NuevoTurnoForm, type NuevoTurnoData } from "./nuevo-turno-form";
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

/** Un solo copy de carga para toda la agenda. */
function Cargando() {
  return (
    <p className="py-16 text-center text-[14px] text-ink-500">Cargando…</p>
  );
}

export function AgendaView() {
  const isMobile = React.useSyncExternalStore(
    subscribeMedia,
    getMobileSnapshot,
    getMobileServerSnapshot,
  );
  const [userView, setUserView] = React.useState<AgendaViewMode | null>(null);
  // `anchor` y `today` son null en el servidor para que el primer render sea
  // idéntico en server (UTC) y client (Montevideo). Renderizar
  // `fechaLarga(anchor)` con un `new Date()` distinto en cada entorno
  // disparaba React #418 y rompía todos los event handlers en producción.
  const today = useHoy();
  const [anchorUsuario, setAnchorUsuario] = React.useState<Date | null>(null);
  const anchor = anchorUsuario ?? today;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [detalleId, setDetalleId] = React.useState<string | null>(null);
  // Mobile: el mes se despliega detrás del título de la fecha.
  const [mesAbierto, setMesAbierto] = React.useState(false);
  const [toast, setToast] = React.useState<{ open: boolean; message: string }>(
    { open: false, message: "" },
  );

  // En mobile siempre se mira un día (la semana se dibuja como día). "mes"
  // en mobile vive en el desplegable, no como vista.
  const view: AgendaViewMode = isMobile ? "día" : (userView ?? "semana");

  // En mobile, con el mes abierto, hacen falta los turnos de todo el mes
  // para pintar los puntos de cada día.
  const rangeView: AgendaViewMode = isMobile && mesAbierto ? "mes" : view;

  const range = React.useMemo(
    () => (anchor ? computeRange(rangeView, anchor) : null),
    [rangeView, anchor],
  );
  const rangeKey = range
    ? `${range.desde.toISOString()}|${range.hasta.toISOString()}`
    : null;

  const cacheRef = React.useRef<Map<string, TurnoConPaciente[]>>(new Map());
  const [turnos, setTurnos] = React.useState<TurnoConPaciente[] | null>(null);
  const [turnosStatus, setTurnosStatus] = React.useState<LoadState>("idle");
  const [refreshKey, setRefreshKey] = React.useState(0);

  // El estado de carga se resuelve en los callbacks de la red; lo único
  // sincrónico es servir la caché, que no dispara ninguna carga.
  React.useEffect(() => {
    if (!rangeKey || !range) return;
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      // Servir caché es un cambio de datos, no de estado de carga: se hace
      // en un microtask para no encadenar renders desde el efecto.
      const id = window.setTimeout(() => {
        setTurnos(cached);
        setTurnosStatus("idle");
      }, 0);
      return () => window.clearTimeout(id);
    }

    const controller = new AbortController();
    const url =
      `/api/turnos?desde=${encodeURIComponent(range.desde.toISOString())}` +
      `&hasta=${encodeURIComponent(range.hasta.toISOString())}`;

    const marcando = window.setTimeout(() => setTurnosStatus("loading"), 0);

    apiGet<RawTurno[]>(url, { signal: controller.signal })
      .then((data) => {
        const parsed = data.map(parseTurno);
        cacheRef.current.set(rangeKey, parsed);
        setTurnos(parsed);
        setTurnosStatus("idle");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setTurnosStatus("error");
      });

    return () => {
      window.clearTimeout(marcando);
      controller.abort();
    };
  }, [rangeKey, range, refreshKey]);

  // Pacientes y configuración: se piden al abrir el sheet de agendar.
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [pacientesStatus, setPacientesStatus] =
    React.useState<LoadState>("idle");
  const [tarifaDefault, setTarifaDefault] = React.useState<number | null>(null);

  const fetchPacientes = React.useCallback(() => {
    setPacientesStatus("loading");
    Promise.all([
      apiGet<PacienteConDeuda[]>("/api/pacientes"),
      apiGet<Configuracion>("/api/config").catch(() => null),
    ])
      .then(([lista, config]) => {
        setPacientes(lista);
        setTarifaDefault(config ? config.tarifaDefault : null);
        setPacientesStatus("idle");
      })
      .catch(() => {
        setPacientesStatus("error");
      });
  }, []);

  const handlePrev = () => {
    setAnchorUsuario((elegido) => {
      const d = elegido ?? today;
      if (!d) return elegido;
      if (isMobile && mesAbierto) return addMonths(d, -1);
      if (view === "día") return addDays(d, -1);
      if (view === "semana") return addWeeks(d, -1);
      return addMonths(d, -1);
    });
  };
  const handleNext = () => {
    setAnchorUsuario((elegido) => {
      const d = elegido ?? today;
      if (!d) return elegido;
      if (isMobile && mesAbierto) return addMonths(d, 1);
      if (view === "día") return addDays(d, 1);
      if (view === "semana") return addWeeks(d, 1);
      return addMonths(d, 1);
    });
  };
  const handleToday = () => {
    setAnchorUsuario(new Date());
    setMesAbierto(false);
  };
  const handleDayClick = (day: Date) => {
    setAnchorUsuario(day);
    setUserView("día");
    setMesAbierto(false);
  };
  const handleEventClick = (turno: TurnoConPaciente) => {
    setDetalleId(turno.id);
  };

  const selectedTurno = React.useMemo(
    () =>
      detalleId
        ? ((turnos ?? []).find((t) => t.id === detalleId) ?? null)
        : null,
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

  // Lanza ApiClientError si la API rechaza: el formulario lo muestra.
  const handleCreateTurno = async (data: NuevoTurnoData) => {
    const fechaISO = new Date(`${data.fecha}T${data.hora}:00`).toISOString();
    try {
      await apiPost<Turno>("/api/turnos", {
        pacienteId: data.pacienteId,
        fecha: fechaISO,
        duracion: data.duracion,
        modalidad: data.modalidad,
        notas: data.notas ? data.notas : null,
      });
    } catch (err) {
      if (err instanceof ApiClientError) throw err;
      throw new ApiClientError(ALGO_FALLO, 0);
    }
    setSheetOpen(false);
    setToast({ open: true, message: "Turno agendado" });
    // Si se creó un paciente en el camino, la lista tiene que reflejarlo.
    setPacientes(null);
    refetchTurnos();
  };

  const retryTurnos = () => {
    if (rangeKey) cacheRef.current.delete(rangeKey);
    setRefreshKey((k) => k + 1);
  };

  const showFullError = turnos === null && turnosStatus === "error";
  const showFullLoading = turnos === null && turnosStatus !== "error";
  const showUpdateHint = turnos !== null && turnosStatus === "loading";

  // Hasta tener `anchor`/`today` (post-mount) renderizamos un placeholder neutro
  // sin fechas: cualquier `fechaLarga(anchor)` con un `new Date()` recién creado
  // produce strings distintos en server (UTC) y client (Montevideo) y dispara
  // el mismo React #418 que rompe los event handlers.
  const isReady = anchor !== null && today !== null;

  return (
    <>
      <div className="mx-auto w-full max-w-[1200px] p-5 lg:p-12">
        {isReady ? (
          <AgendaHeader
            view={view}
            onViewChange={setUserView}
            anchor={anchor}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            onNewTurno={openSheet}
            mesAbierto={mesAbierto}
            onToggleMes={() => setMesAbierto((v) => !v)}
          />
        ) : (
          <header className="h-[44px] lg:h-[40px]" aria-hidden="true" />
        )}

        {/* Mobile: el mes, detrás del título de la fecha */}
        {isReady && isMobile && mesAbierto ? (
          <div id="agenda-mes-mobile" className="mt-3 lg:hidden">
            <MonthView
              anchor={anchor}
              today={today}
              turnos={turnos ?? []}
              onDayClick={handleDayClick}
            />
          </div>
        ) : null}

        <div aria-live="polite" className="mt-3 h-4 text-[11px] text-ink-300">
          {showUpdateHint ? "Actualizando…" : null}
        </div>

        <div className="mt-3 lg:mt-4">
          {!isReady || showFullLoading ? (
            <Cargando />
          ) : showFullError ? (
            <EstadoVacio
              icono={<CalendarX2 size={28} strokeWidth={1.6} aria-hidden="true" />}
              titulo={ALGO_FALLO}
              lineas={[
                "No pudimos traer la agenda.",
                "Puede ser la conexión.",
                "Tus turnos no se perdieron.",
              ]}
              accion={{ label: "Reintentar", onClick: retryTurnos }}
            />
          ) : turnos !== null ? (
            view === "día" ? (
              <DayView
                date={anchor}
                turnos={turnos}
                onOpenTurno={handleEventClick}
                onNuevoTurno={openSheet}
              />
            ) : view === "semana" ? (
              <WeekView
                anchor={anchor}
                turnos={turnos}
                today={today}
                onEventClick={handleEventClick}
              />
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

      <Fab label="Agendar" onClick={openSheet} />

      <Sheet open={sheetOpen} onClose={closeSheet} ariaLabel="Agendar">
        {pacientes === null && pacientesStatus === "error" ? (
          <EstadoVacio
            icono={<CalendarX2 size={28} strokeWidth={1.6} aria-hidden="true" />}
            titulo={ALGO_FALLO}
            lineas={[
              "No pudimos traer tus pacientes.",
              "Sin la lista no se puede agendar.",
              "Probá de nuevo en un momento.",
            ]}
            accion={{ label: "Reintentar", onClick: fetchPacientes }}
          />
        ) : pacientes === null ? (
          <Cargando />
        ) : (
          <NuevoTurnoForm
            pacientes={pacientes}
            tarifaDefault={tarifaDefault}
            fechaInicial={anchor}
            onSubmit={handleCreateTurno}
            onCancel={closeSheet}
          />
        )}
      </Sheet>

      <TurnoDetailSheet
        key={detalleId ?? "closed"}
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
