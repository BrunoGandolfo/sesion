"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { isToday } from "date-fns";

import { Button, Segmented, Sheet, Toast } from "@/components/ui";
import type {
  Configuracion,
  PacienteConDeuda,
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

  function refetchData() {
    setReloadKey((c) => c + 1);
  }

  function handleEditarSuccess() {
    setEditarOpen(false);
    setToast({ open: true, message: "Paciente actualizado" });
    refetchData();
  }

  if (loading && !paciente) {
    return <DetailSkeleton />;
  }

  if (error || !paciente) {
    return (
      <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
        <BackLink />
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
      </div>
    );
  }

  const nombreCompleto = `${paciente.nombre} ${paciente.apellido}`;
  const tarifaDefault = config?.tarifaDefault ?? paciente.tarifa;

  return (
    <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
      <BackLink />

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
        <DatosTab paciente={paciente} onPacienteActualizado={refetchData} />
      )}

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

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((c) => ({ ...c, open: false }))}
      />
    </div>
  );
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

function DetailSkeleton() {
  return (
    <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
      <div className="h-4 w-24 rounded-sm bg-cream-200 mb-5" />
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
    </div>
  );
}
