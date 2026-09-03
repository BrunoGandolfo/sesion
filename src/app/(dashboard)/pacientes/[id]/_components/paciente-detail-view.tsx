"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FileCheck,
  Loader2,
  Mic,
} from "lucide-react";
import { isToday } from "date-fns";

import { Button, Segmented, Sheet, Toast } from "@/components/ui";
import { GrabadorSesion } from "@/components/grabacion/GrabadorSesion";
import { NotaClinicaView } from "@/components/grabacion/NotaClinicaView";
import { FeedbackTerapeutaView } from "@/components/grabacion/FeedbackTerapeutaView";
import { useGrabacionSesion } from "@/hooks/useGrabacionSesion";
import { fechaLarga } from "@/lib/format";
import type {
  Configuracion,
  PacienteConDeuda,
  SesionClinicaResponse,
  Turno,
} from "@/types/domain";

import { DatosTab } from "./datos-tab";
import { EditarPacienteForm } from "./editar-paciente-form";
import { HistoriaTab } from "./historia-tab";
import { ProgresoTab } from "./progreso-tab";
import { ResumenTab } from "./resumen-tab";
import { TurnosPagosTab } from "./turnos-pagos-tab";

type TabKey = "resumen" | "historia" | "progreso" | "turnos" | "datos";

const TAB_OPTIONS: { value: TabKey; label: string }[] = [
  { value: "resumen", label: "Resumen" },
  { value: "historia", label: "Historia" },
  { value: "progreso", label: "Progreso" },
  { value: "turnos", label: "Turnos" },
  { value: "datos", label: "Datos" },
];

type PacienteJson = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
};

type TurnoJson = Omit<
  Turno,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

type PacienteDetailResponse = {
  data: PacienteJson;
  turnos: TurnoJson[];
};

type ConsentimientoApiResponse = {
  consentimiento: { vigente: boolean } | null;
};

type ToastState = { open: boolean; message: string };

function parsePaciente(p: PacienteJson): PacienteConDeuda {
  return {
    ...p,
    creadoEn: new Date(p.creadoEn),
    actualizadoEn: new Date(p.actualizadoEn),
    ultimaSesion: p.ultimaSesion ? new Date(p.ultimaSesion) : null,
  };
}

function parseTurno(t: TurnoJson): Turno {
  return {
    ...t,
    fecha: new Date(t.fecha),
    pagoFecha: t.pagoFecha ? new Date(t.pagoFecha) : null,
    creadoEn: new Date(t.creadoEn),
    actualizadoEn: new Date(t.actualizadoEn),
  };
}

async function fetchPacienteDetail(
  id: string,
  signal?: AbortSignal,
): Promise<{ paciente: PacienteConDeuda; turnos: Turno[] }> {
  const response = await fetch(`/api/pacientes/${id}`, { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No encontramos ese paciente."
        : "No se pudo cargar la ficha.",
    );
  }
  const json = (await response.json()) as PacienteDetailResponse;
  return {
    paciente: parsePaciente(json.data),
    turnos: json.turnos.map(parseTurno),
  };
}

export function PacienteDetailView({ id }: { id: string }) {
  const [paciente, setPaciente] = React.useState<PacienteConDeuda | null>(null);
  const [turnos, setTurnos] = React.useState<Turno[]>([]);
  const [config, setConfig] = React.useState<Configuracion | null>(null);
  const [consentimientoVigente, setConsentimientoVigente] =
    React.useState<boolean>(false);
  const [activeTab, setActiveTab] = React.useState<TabKey>("resumen");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editarOpen, setEditarOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>({
    open: false,
    message: "",
  });

  React.useEffect(() => {
    const controller = new AbortController();
    fetchPacienteDetail(id, controller.signal)
      .then((data) => {
        setPaciente(data.paciente);
        setTurnos(data.turnos);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "No se pudo cargar la ficha.",
        );
        setLoading(false);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data: Configuracion } | null) => {
        if (json) setConfig(json.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pacientes/${id}/consentimiento`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) =>
        r.ok ? (r.json() as Promise<ConsentimientoApiResponse>) : null,
      )
      .then((json) => {
        if (!json) return;
        setConsentimientoVigente(json.consentimiento?.vigente === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, reloadKey]);

  const turnoHoy = React.useMemo(() => {
    const hoy = turnos
      .filter(
        (t) =>
          (t.estado === "programado" || t.estado === "realizado") &&
          isToday(t.fecha),
      )
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return hoy[0] ?? null;
  }, [turnos]);

  function retryLoad() {
    setLoading(true);
    setError(null);
    setReloadKey((c) => c + 1);
  }

  const refetchData = React.useCallback(() => {
    setReloadKey((c) => c + 1);
  }, []);

  const {
    sesionClinica,
    submitting: grabacionSubmitting,
    error: grabacionError,
    subidaPendiente,
    progresoSubida,
    iniciar: iniciarGrabacion,
    completar: completarGrabacion,
    reintentarSubida,
    reintentar: reintentarGrabacion,
    refrescar: refrescarGrabacion,
  } = useGrabacionSesion({
    turno: turnoHoy,
    onTurnoActualizado: refetchData,
    onError: (mensaje) => setToast({ open: true, message: mensaje }),
  });

  const [grabacionSheetOpen, setGrabacionSheetOpen] = React.useState(false);

  const fabEstado = deriveFabEstado(
    turnoHoy,
    consentimientoVigente,
    sesionClinica,
  );

  function handleFabTap() {
    if (fabEstado === "sin-turno") {
      setToast({
        open: true,
        message: "No hay turno programado para hoy.",
      });
      return;
    }
    if (fabEstado === "sin-consentimiento") {
      setToast({
        open: true,
        message: "Firmá el consentimiento en la tab Datos.",
      });
      return;
    }
    if (fabEstado === "aprobado") {
      setToast({ open: true, message: "Sesión ya documentada." });
      return;
    }
    if (fabEstado === "idle") {
      setGrabacionSheetOpen(true);
      void iniciarGrabacion();
      return;
    }
    setGrabacionSheetOpen(true);
  }

  async function handleNotaResuelta() {
    await refrescarGrabacion();
    setGrabacionSheetOpen(false);
  }

  function handleEditarSuccess() {
    setEditarOpen(false);
    setToast({ open: true, message: "Paciente actualizado" });
    refetchData();
  }

  const nombreCompleto = paciente
    ? `${paciente.nombre} ${paciente.apellido}`
    : "";
  const tarifaDefault = config?.tarifaDefault ?? paciente?.tarifa ?? 0;
  const mostrarSkeleton = loading && !paciente;
  const mostrarError = !mostrarSkeleton && (error !== null || !paciente);

  return (
    <>
      <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
        <BackLink />

        {mostrarSkeleton ? <DetailSkeletonInner /> : null}

        {mostrarError ? (
          <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 text-center">
            <p className="font-display text-[18px] font-medium text-ink-900">
              No pudimos abrir la ficha.
            </p>
            <p className="mt-1 text-[13px] text-ink-500">
              {error ?? "Probá de nuevo en un momento."}
            </p>
            <div className="mt-5">
              <Button variant="secondary" onClick={retryLoad}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {paciente && !mostrarError ? (
          <>
            <div className="mb-6 lg:mb-8 overflow-x-auto">
              <Segmented
                options={TAB_OPTIONS}
                value={activeTab}
                onChange={setActiveTab}
                ariaLabel="Secciones del paciente"
              />
            </div>

            {activeTab === "resumen" && (
              <ResumenTab
                paciente={paciente}
                turnos={turnos}
                config={{ tarifaDefault }}
                onEditar={() => setEditarOpen(true)}
                onCambiarTab={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === "historia" && (
              <HistoriaTab
                pacienteId={paciente.id}
                pacienteNombre={nombreCompleto}
                turnoHoy={turnoHoy}
                consentimientoVigente={consentimientoVigente}
                onTurnoActualizado={refetchData}
              />
            )}

            {activeTab === "progreso" && (
              <ProgresoTab
                pacienteId={paciente.id}
                nombrePaciente={nombreCompleto}
              />
            )}

            {activeTab === "turnos" && (
              <TurnosPagosTab
                pacienteId={paciente.id}
                turnos={turnos}
                onTurnoActualizado={refetchData}
              />
            )}

            {activeTab === "datos" && (
              <DatosTab
                paciente={paciente}
                onPacienteActualizado={refetchData}
              />
            )}
          </>
        ) : null}
      </div>

      {paciente ? (
        <Sheet
          open={editarOpen}
          onClose={() => setEditarOpen(false)}
          maxWidth={520}
          ariaLabel="Editar paciente"
        >
          <EditarPacienteForm
            paciente={paciente}
            onSuccess={handleEditarSuccess}
            onCancel={() => setEditarOpen(false)}
          />
        </Sheet>
      ) : null}

      <Sheet
        open={grabacionSheetOpen}
        onClose={() => setGrabacionSheetOpen(false)}
        maxWidth={640}
        ariaLabel="Grabación de sesión"
      >
        <GrabacionSheetContent
          estado={fabEstado}
          sesion={sesionClinica}
          submitting={grabacionSubmitting}
          turno={turnoHoy}
          pacienteNombre={nombreCompleto}
          subidaPendiente={subidaPendiente}
          progresoSubida={progresoSubida}
          errorSubida={grabacionError}
          onGrabacionCompleta={(d) => void completarGrabacion(d)}
          onErrorGrabacion={(m) =>
            setToast({ open: true, message: m })
          }
          onReintentarSubida={() => void reintentarSubida()}
          onReintentar={() => void reintentarGrabacion()}
          onAprobado={() => void handleNotaResuelta()}
        />
      </Sheet>

      <RecordingFab estado={fabEstado} onTap={handleFabTap} />

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((c) => ({ ...c, open: false }))}
      />
    </>
  );
}

type FabEstado =
  | "sin-turno"
  | "sin-consentimiento"
  | "idle"
  | "grabando"
  | "procesando"
  | "revision"
  | "error"
  | "aprobado";

function deriveFabEstado(
  turnoHoy: Turno | null,
  consentimientoVigente: boolean,
  sesion: SesionClinicaResponse | null,
): FabEstado {
  if (!turnoHoy) return "sin-turno";
  if (!consentimientoVigente && !sesion) return "sin-consentimiento";
  if (!sesion) return "idle";
  switch (sesion.estado) {
    case "grabando":
      return "grabando";
    case "subiendo":
    case "procesando":
      return "procesando";
    case "revision":
      return "revision";
    case "error":
      return "error";
    case "aprobado":
      return "aprobado";
    default:
      return "idle";
  }
}

type FabVisual = {
  Icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
    className?: string;
  }>;
  bg: string;
  dimmed: boolean;
  pulse: boolean;
  spin: boolean;
  badge: "alerta" | "numero" | null;
  label: string;
};

const FAB_VISUALS: Record<FabEstado, FabVisual> = {
  "sin-turno": {
    Icon: Mic,
    bg: "bg-sage-500 hover:bg-sage-600",
    dimmed: true,
    pulse: false,
    spin: false,
    badge: null,
    label: "Grabación no disponible: sin turno hoy",
  },
  "sin-consentimiento": {
    Icon: Mic,
    bg: "bg-sage-500 hover:bg-sage-600",
    dimmed: false,
    pulse: false,
    spin: false,
    badge: "alerta",
    label: "Falta firmar el consentimiento",
  },
  idle: {
    Icon: Mic,
    bg: "bg-sage-500 hover:bg-sage-600",
    dimmed: false,
    pulse: false,
    spin: false,
    badge: null,
    label: "Grabar sesión",
  },
  grabando: {
    Icon: Mic,
    bg: "bg-terracotta-500 hover:bg-terracotta-600",
    dimmed: false,
    pulse: true,
    spin: false,
    badge: null,
    label: "Grabación en curso",
  },
  procesando: {
    Icon: Loader2,
    bg: "bg-gold-500 hover:bg-gold-500",
    dimmed: false,
    pulse: false,
    spin: true,
    badge: null,
    label: "Procesando sesión",
  },
  revision: {
    Icon: FileCheck,
    bg: "bg-gold-500 hover:bg-gold-500",
    dimmed: false,
    pulse: false,
    spin: false,
    badge: "numero",
    label: "Nota lista para revisar",
  },
  error: {
    Icon: Mic,
    bg: "bg-terracotta-500 hover:bg-terracotta-600",
    dimmed: false,
    pulse: false,
    spin: false,
    badge: "alerta",
    label: "Error de grabación, tocá para reintentar",
  },
  aprobado: {
    Icon: CheckCircle2,
    bg: "bg-sage-500 hover:bg-sage-600",
    dimmed: false,
    pulse: false,
    spin: false,
    badge: null,
    label: "Sesión documentada",
  },
};

function RecordingFab({
  estado,
  onTap,
}: {
  estado: FabEstado;
  onTap: () => void;
}) {
  const v = FAB_VISUALS[estado];
  const Icon = v.Icon;

  return (
    <motion.button
      type="button"
      aria-label={v.label}
      onClick={onTap}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed bottom-24 right-5 lg:bottom-8 lg:right-8 z-30 inline-flex items-center justify-center w-14 h-14 lg:w-12 lg:h-12 rounded-full text-white shadow-raised focus:outline-none focus:ring-[3px] focus:ring-sage-500/30 transition-colors duration-150 ${v.bg} ${v.dimmed ? "opacity-50" : ""} ${v.pulse ? "animate-pulse" : ""}`}
    >
      <span className="relative inline-flex items-center justify-center">
        <Icon
          size={24}
          strokeWidth={1.9}
          aria-hidden={true}
          className={v.spin ? "animate-spin" : ""}
        />
        {v.badge === "numero" ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-terracotta-500 text-white text-[10px] font-semibold tabular-nums ring-2 ring-white"
          >
            1
          </span>
        ) : null}
        {v.badge === "alerta" ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-terracotta-500 text-white ring-2 ring-white"
          >
            <AlertCircle size={11} strokeWidth={2.4} aria-hidden="true" />
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

function GrabacionSheetContent({
  estado,
  sesion,
  submitting,
  turno,
  pacienteNombre,
  subidaPendiente,
  progresoSubida,
  errorSubida,
  onGrabacionCompleta,
  onErrorGrabacion,
  onReintentarSubida,
  onReintentar,
  onAprobado,
}: {
  estado: FabEstado;
  sesion: SesionClinicaResponse | null;
  submitting: boolean;
  turno: Turno | null;
  pacienteNombre: string;
  subidaPendiente: boolean;
  progresoSubida: number | null;
  errorSubida: string | null;
  onGrabacionCompleta: (datos: {
    audioBlob: Blob;
    claveCifrado: string;
    ivCifrado: string;
    duracionSegundos: number;
  }) => void;
  onErrorGrabacion: (mensaje: string) => void;
  onReintentarSubida: () => void;
  onReintentar: () => void;
  onAprobado: () => void;
}) {
  if (!turno) {
    return (
      <p className="font-sans text-[14px] text-ink-500">
        No hay turno programado para hoy.
      </p>
    );
  }

  if (!sesion) {
    return (
      <div className="flex items-center gap-3 py-6">
        <Loader2
          size={18}
          strokeWidth={1.8}
          aria-hidden="true"
          className="shrink-0 animate-spin text-sage-500"
        />
        <span className="font-sans text-[14px] text-ink-700">
          Preparando grabación…
        </span>
      </div>
    );
  }

  if (sesion.estado === "grabando") {
    return (
      <GrabadorSesion
        turnoId={turno.id}
        pacienteNombre={pacienteNombre}
        onGrabacionCompleta={onGrabacionCompleta}
        onError={onErrorGrabacion}
        subidaPendiente={subidaPendiente}
        progresoSubida={progresoSubida}
        errorSubida={errorSubida}
        onReintentarSubida={onReintentarSubida}
      />
    );
  }

  if (sesion.estado === "subiendo" || sesion.estado === "procesando") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2
          size={32}
          strokeWidth={1.8}
          aria-hidden="true"
          className="animate-spin text-gold-500"
        />
        <p className="font-display italic text-[18px] font-medium text-ink-900">
          Procesando tu sesión…
        </p>
        <p className="font-sans text-[13px] leading-[1.5] text-ink-500 max-w-[360px]">
          Esto puede tardar entre 3 y 5 minutos. Podés cerrar este panel y
          seguir trabajando; te avisamos cuando la nota esté lista.
        </p>
      </div>
    );
  }

  if (sesion.estado === "revision" && sesion.nota) {
    return (
      <div className="flex flex-col gap-5">
        <NotaClinicaView
          sesionClinicaId={sesion.id}
          nota={sesion.nota}
          datosEstructurados={sesion.datosEstructurados}
          pacienteNombre={pacienteNombre}
          fechaSesion={fechaLarga(turno.fecha)}
          onAprobado={onAprobado}
        />
        {sesion.datosEstructurados?.feedbackTerapeuta ? (
          <FeedbackTerapeutaView
            feedbackTerapeuta={sesion.datosEstructurados.feedbackTerapeuta}
          />
        ) : null}
      </div>
    );
  }

  if (sesion.estado === "aprobado" && sesion.nota) {
    return (
      <NotaClinicaView
        sesionClinicaId={sesion.id}
        nota={sesion.nota}
        datosEstructurados={sesion.datosEstructurados}
        pacienteNombre={pacienteNombre}
        fechaSesion={fechaLarga(turno.fecha)}
        onAprobado={onAprobado}
      />
    );
  }

  if (sesion.estado === "error") {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="flex items-start gap-2 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3">
          <AlertCircle
            size={18}
            strokeWidth={1.9}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
          <div className="flex flex-col gap-1">
            <p className="font-sans text-[13px] font-semibold text-ink-900">
              Error en el procesamiento
            </p>
            {sesion.error ? (
              <p className="font-sans text-[12px] text-ink-500">
                {sesion.error}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={onReintentar}
          disabled={submitting}
          className="w-full sm:w-auto"
        >
          {submitting ? "Reintentando…" : "Reintentar"}
        </Button>
      </div>
    );
  }

  void estado;
  return null;
}

function BackLink() {
  return (
    <Link
      href="/pacientes"
      className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-700 transition-colors duration-150 mb-4"
    >
      <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
      <span>Pacientes</span>
    </Link>
  );
}

function DetailSkeletonInner() {
  return (
    <>
      <div className="h-10 w-full max-w-[420px] rounded-md bg-cream-200 mb-8" />
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-cream-200" />
        <div className="flex flex-col gap-3 flex-1">
          <div className="h-8 w-56 rounded-sm bg-cream-200" />
          <div className="h-4 w-full max-w-[520px] rounded-sm bg-cream-100" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mt-8">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="bg-white border border-[color:var(--border-subtle)] rounded-lg p-[14px] lg:p-5"
          >
            <div className="h-3 w-20 rounded-sm bg-cream-200" />
            <div className="mt-3 h-6 w-16 rounded-sm bg-cream-100" />
          </div>
        ))}
      </div>
    </>
  );
}
