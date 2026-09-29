"use client";

import * as React from "react";
import { ResultadoSerie } from "@/components/forms/resultado-serie";
import { useToast } from "@/components/ui/toast";
import { CalendarX2 } from "lucide-react";

import { Fab, Toast } from "@/components/ui";
import { useConfirmacionDibujada } from "@/components/ui/movimiento";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { useEsEscritorio } from "@/hooks/useEsEscritorio";
import { useHoy } from "@/hooks/useHoy";
import { crearTurno, mensajeTurnoAgendado } from "@/lib/agendar-turno";
import { SheetNuevoTurno } from "@/components/forms/sheet-nuevo-turno";
import { apiGet, esAbort } from "@/lib/api-client";
import { parseTurno, type TurnoJson } from "@/lib/json-turno";
import {
  agregarDiasMvd,
  finDelDiaMvd,
  inicioDeMesMvd,
  inicioDeSemanaMvd,
  inicioFinDiaMvd,
  agregarMesesMvd,
  esMismoDiaMvd,
} from "@/lib/fechas-montevideo";
import { AGENDAR, ALGO_FALLO } from "@/lib/glosario";
import type { TurnoCreado, TurnoConPaciente } from "@/types/domain";

import { AgendaHeader } from "./agenda-header";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { SemanaTira } from "./semana-tira";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { TurnoDetailSheet } from "./turno-detail-sheet";

export type AgendaViewMode = "día" | "semana" | "mes";

// El rango que se le pide a la API. Los bordes son los del día de
// Montevideo, no los del dispositivo: con `setHours` un teléfono en Madrid
// pedía de las 19:00 del día anterior a las 18:59 del día, y la sesión de
// las 21:30 quedaba fuera de su propio día.
function computeRange(
  view: AgendaViewMode,
  anchor: Date,
): { desde: Date; hasta: Date } {
  if (view === "día") {
    return inicioFinDiaMvd(anchor);
  }
  if (view === "semana") {
    const desde = inicioDeSemanaMvd(anchor);
    return { desde, hasta: finDelDiaMvd(agregarDiasMvd(desde, 6)) };
  }
  // Seis semanas completas desde el lunes de la semana en que cae el día 1:
  // la grilla del mes siempre dibuja 42 celdas.
  const desde = inicioDeSemanaMvd(inicioDeMesMvd(anchor));
  return { desde, hasta: finDelDiaMvd(agregarDiasMvd(desde, 41)) };
}

type LoadState = "idle" | "loading" | "error";

/** El respiro del check de D9 no cierra nada: el sheet ya se fue solo con
 *  onUpdated y la marca vive en la fila. Estable, para no reiniciar el
 *  temporizador en cada render. */
const SIN_NADA_QUE_HACER = () => {};

/** Un solo copy de carga para toda la agenda. */
function Cargando() {
  return (
    <p className="py-16 text-center text-[14px] text-ink-500">Cargando…</p>
  );
}

export function AgendaView() {
  const isMobile = !useEsEscritorio();
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
  // D9: la fila que originó el cobro se queda con el trazo mientras el sheet
  // se cierra. No agrega tiempo: ocurre mientras el sheet se va.
  const [turnoCobradoId, marcarCobrado] =
    useConfirmacionDibujada<string>(SIN_NADA_QUE_HACER);
  // Mobile: el mes se despliega detrás del título de la fecha.
  const [mesAbierto, setMesAbierto] = React.useState(false);
  const [resultadoSerie, setResultadoSerie] = React.useState<TurnoCreado["serie"]>(null);
  const toast = useToast();

  // En mobile siempre se mira un día (la semana se dibuja como día). "mes"
  // en mobile vive en el desplegable, no como vista.
  const view: AgendaViewMode = isMobile ? "día" : (userView ?? "semana");

  // En mobile, con el mes abierto, hacen falta los turnos de todo el mes
  // para pintar los puntos de cada día; con el mes plegado, los de la semana
  // del día elegido, que es lo que muestra la tira. Moverse dentro de la
  // semana no vuelve a pedir nada: es el mismo rango.
  const rangeView: AgendaViewMode = isMobile
    ? mesAbierto
      ? "mes"
      : "semana"
    : view;

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
    // Con los cancelados: la agenda los muestra apagados (session-row y el
    // punto gris del mes ya los distinguen). Sin este parámetro la API los
    // filtra, y un turno cancelado desaparecía de la grilla como si nunca
    // hubiera existido — que es lo que la deja sin saber si lo canceló.
    const url =
      `/api/turnos?desde=${encodeURIComponent(range.desde.toISOString())}` +
      `&hasta=${encodeURIComponent(range.hasta.toISOString())}` +
      `&includeCancelados=true`;

    const marcando = window.setTimeout(() => setTurnosStatus("loading"), 0);

    apiGet<TurnoJson<TurnoConPaciente>[]>(url, { signal: controller.signal })
      .then((data) => {
        const parsed = data.map((t) => parseTurno(t));
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

  const handlePrev = () => {
    setAnchorUsuario((elegido) => {
      const d = elegido ?? today;
      if (!d) return elegido;
      if (isMobile && mesAbierto) return agregarMesesMvd(d, -1);
      // Mes plegado: las flechas mueven la tira de a una semana.
      if (isMobile) return agregarDiasMvd(d, -7);
      if (view === "día") return agregarDiasMvd(d, -1);
      if (view === "semana") return agregarDiasMvd(d, -7);
      return agregarMesesMvd(d, -1);
    });
  };
  const handleNext = () => {
    setAnchorUsuario((elegido) => {
      const d = elegido ?? today;
      if (!d) return elegido;
      if (isMobile && mesAbierto) return agregarMesesMvd(d, 1);
      // Mes plegado: las flechas mueven la tira de a una semana.
      if (isMobile) return agregarDiasMvd(d, 7);
      if (view === "día") return agregarDiasMvd(d, 1);
      if (view === "semana") return agregarDiasMvd(d, 7);
      return agregarMesesMvd(d, 1);
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
  // La tira de la semana cambia el día sin tocar nada más.
  const handleDiaDeLaTira = (day: Date) => setAnchorUsuario(day);
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
    toast.confirmar(message);
    refetchTurnos();
  };

  const openSheet = () => setSheetOpen(true);
  const closeSheet = () => setSheetOpen(false);

  // crearTurno relanza el ApiClientError si la API rechaza: el formulario
  // lo muestra. El body y el mensaje son los mismos que en Hoy.
  const handleCreateTurno = async (data: NuevoTurnoData) => {
    const creado = await crearTurno(data);
    setSheetOpen(false);
    if (creado.serie) setResultadoSerie(creado.serie);
    else toast.confirmar(mensajeTurnoAgendado(creado));
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

  // El FAB tapaba la tarjeta punteada del día vacío, a centímetros del botón
  // "Agendar" que esa misma tarjeta ofrece: dos botones para lo mismo, uno
  // sobre el otro. Cuando el estado vacío está en pantalla, el flotante no
  // aparece: el camino a un turno nuevo sigue siendo uno solo, el que ya se
  // está mirando.
  const diaVacio =
    isReady &&
    view === "día" &&
    turnos !== null &&
    !turnos.some((t) => esMismoDiaMvd(t.fecha, anchor));
  const mostrarFab = !diaVacio && !showFullError;

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

        {/* Mobile, mes plegado: la semana del día elegido, debajo del título */}
        {isReady && isMobile && !mesAbierto ? (
          <div className="mt-3 lg:hidden">
            <SemanaTira
              anchor={anchor}
              today={today}
              turnos={turnos ?? []}
              onDayClick={handleDiaDeLaTira}
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
                turnoCobradoId={turnoCobradoId}
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

      {mostrarFab ? <Fab label={AGENDAR} onClick={openSheet} /> : null}

      <SheetNuevoTurno
        open={sheetOpen}
        fechaInicial={anchor}
        onClose={closeSheet}
        onSubmit={handleCreateTurno}
      />

      <TurnoDetailSheet
        key={detalleId ?? "closed"}
        open={detalleId !== null}
        turno={selectedTurno}
        onClose={closeDetalle}
        onUpdated={handleTurnoUpdated}
        onCobrado={marcarCobrado}
      />

      <ResultadoSerie serie={resultadoSerie} onClose={() => setResultadoSerie(null)} />

      <Toast {...toast.props} />
    </>
  );
}
