"use client";

import { AccesoConsultorio } from "@/components/layout/cabecera-usuario";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Plus, RotateCcw, Search } from "lucide-react";
import {
  Avatar,
  Button,
  Chip,
  Fab,
  Input,
  Lupita,
  Segmented,
  Sheet,
  Toast,
} from "@/components/ui";
import { EsqueletoListaPacientes } from "@/components/esqueletos";
import { TAMANOS_LUPITA } from "@/components/ui/lupita";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { ApiClientError, apiGet, apiPatch, esAbort } from "@/lib/api-client";
import { fechaRelativa, money } from "@/lib/format";
import {
  ALGO_FALLO,
  DEBE,
  NUEVO_PACIENTE,
  PACIENTES_VACIO_LINEA,
  PACIENTES_VACIO_TITULO,
} from "@/lib/glosario";
import type { Configuracion, PacienteConDeuda } from "@/types/domain";
import { NuevoPacienteForm } from "./nuevo-paciente-form";

type Segment = "activos" | "archivados";

type PacienteJson = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
};

type ToastState = {
  open: boolean;
  message: string;
};

function parsePaciente(paciente: PacienteJson): PacienteConDeuda {
  return {
    ...paciente,
    creadoEn: new Date(paciente.creadoEn),
    actualizadoEn: new Date(paciente.actualizadoEn),
    ultimaSesion: paciente.ultimaSesion ? new Date(paciente.ultimaSesion) : null,
  };
}

async function fetchPacientes({
  segment,
  query,
  signal,
}: {
  segment: Segment;
  query: string;
  signal?: AbortSignal;
}): Promise<PacienteConDeuda[]> {
  const params = new URLSearchParams({
    activo: segment === "activos" ? "true" : "false",
  });
  const cleanQuery = query.trim();

  if (cleanQuery) {
    params.set("q", cleanQuery);
  }

  const lista = await apiGet<PacienteJson[]>(
    `/api/pacientes?${params.toString()}`,
    { signal },
  );
  return lista.map(parsePaciente);
}

export function PacientesView({
  archivedToast = false,
}: {
  archivedToast?: boolean;
}) {
  const [segment, setSegment] = React.useState<Segment>("activos");
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [showNuevoPaciente, setShowNuevoPaciente] = React.useState(false);
  // Tarifa por sesión de Tu consultorio, para el paciente nuevo. Se pide al
  // abrir el sheet; hasta que llega (o si falla) el campo arranca vacío.
  const [tarifaDefault, setTarifaDefault] = React.useState<number | null>(null);
  const [tarifaCargada, setTarifaCargada] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>(() => ({
    open: archivedToast,
    message: archivedToast ? "Paciente archivado" : "",
  }));

  const openNuevoPaciente = React.useCallback(() => {
    setShowNuevoPaciente(true);
    if (tarifaCargada) return;
    apiGet<Configuracion>("/api/config")
      .then((config) => {
        setTarifaDefault(config.tarifaDefault);
        setTarifaCargada(true);
      })
      .catch(() => {
        // Sin configuración no hay tarifa sugerida: el campo queda vacío.
        setTarifaCargada(true);
      });
  }, [tarifaCargada]);
  const closeNuevoPaciente = React.useCallback(
    () => setShowNuevoPaciente(false),
    [],
  );
  const handleNuevoPacienteSuccess = React.useCallback(() => {
    setShowNuevoPaciente(false);
    setToast({ open: true, message: "Paciente creado" });
    setSegment("activos");
    setReloadKey((current) => current + 1);
  }, []);

  React.useEffect(() => {
    if (query === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setDebouncedQuery(query);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, debouncedQuery]);

  React.useEffect(() => {
    const controller = new AbortController();

    fetchPacientes({
      segment,
      query: debouncedQuery,
      signal: controller.signal,
    })
      .then((data) => {
        setPacientes(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setError(err instanceof ApiClientError ? err.mensaje : ALGO_FALLO);
        setLoading(false);
      });

    return () => controller.abort();
  }, [segment, debouncedQuery, reloadKey]);

  async function reactivarPaciente(paciente: PacienteConDeuda) {
    setReactivatingId(paciente.id);
    setPacientes((current) => current.filter((item) => item.id !== paciente.id));

    try {
      await apiPatch(`/api/pacientes/${paciente.id}`, { activo: true });
      setToast({ open: true, message: "Paciente reactivado" });
    } catch (err) {
      setPacientes((current) =>
        [...current, paciente].sort((a, b) =>
          `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`),
        ),
      );
      setToast({
        open: true,
        message: err instanceof ApiClientError ? err.mensaje : ALGO_FALLO,
      });
    } finally {
      setReactivatingId(null);
    }
  }

  function handleSegmentChange(nextSegment: Segment) {
    setLoading(true);
    setError(null);
    setSegment(nextSegment);
  }

  function retryLoad() {
    setLoading(true);
    setError(null);
    setReloadKey((current) => current + 1);
  }

  const options = [
    { value: "activos" as const, label: "Activos" },
    { value: "archivados" as const, label: "Archivados" },
  ];

  const emptyKind: "search" | "noPatients" | "noArchived" | null =
    pacientes.length > 0
      ? null
      : debouncedQuery.trim()
        ? "search"
        : segment === "activos"
          ? "noPatients"
          : "noArchived";

  return (
    <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-[30px] font-medium text-ink-900 tracking-tight leading-tight">
          Pacientes
        </h1>
        <AccesoConsultorio />
      </div>

      <div className="flex items-center justify-between gap-3 mb-5">
        <Segmented
          ariaLabel="Filtro de pacientes"
          value={segment}
          onChange={handleSegmentChange}
          options={options}
        />
        <div className="hidden lg:block">
          <Button
            size="sm"
            onClick={openNuevoPaciente}
            icon={<Plus size={16} strokeWidth={1.6} aria-hidden="true" />}
          >
            {NUEVO_PACIENTE}
          </Button>
        </div>
      </div>

      <div className="relative mb-5">
        <Search
          aria-hidden="true"
          size={18}
          strokeWidth={1.6}
          className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-ink-500 z-10"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre..."
          aria-label="Buscar por nombre"
          className="pl-[42px]"
        />
      </div>

      {/* La segunda espera: la ruta ya llegó y falta /api/pacientes. Es la
          misma lista gris que dibujó el loading.tsx de esta carpeta —el
          mismo componente—, así que entre una espera y la otra no parpadea
          nada. El título, el filtro y el buscador de arriba ya son tocables
          y por eso quedan afuera del esqueleto. */}
      {loading && pacientes.length === 0 ? (
        <EsqueletoListaPacientes />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={retryLoad}
        />
      ) : emptyKind ? (
        <EmptyState kind={emptyKind} onCrear={openNuevoPaciente} />
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : undefined}>
          <DesktopTable
            pacientes={pacientes}
            archived={segment === "archivados"}
            reactivatingId={reactivatingId}
            onReactivar={reactivarPaciente}
          />
          <MobileList
            pacientes={pacientes}
            archived={segment === "archivados"}
            reactivatingId={reactivatingId}
            onReactivar={reactivarPaciente}
          />
        </div>
      )}

      {/* El FAB es fijo y opaco: sin este colchón tapaba la última fila de
          la lista (docs/diseno/01-auditoria-frontend.md, sección 3). */}
      <div aria-hidden="true" className="h-24 lg:hidden" />

      <Fab label={NUEVO_PACIENTE} onClick={openNuevoPaciente} />

      <Sheet
        open={showNuevoPaciente}
        onClose={closeNuevoPaciente}
        ariaLabel={NUEVO_PACIENTE}
      >
        <div className="-mx-6 -mb-6 lg:-m-7">
          {tarifaCargada ? (
            <NuevoPacienteForm
              tarifaDefault={tarifaDefault}
              onSuccess={handleNuevoPacienteSuccess}
              onCancel={closeNuevoPaciente}
            />
          ) : (
            <p className="py-16 text-center text-[14px] text-ink-500">
              Cargando…
            </p>
          )}
        </div>
      </Sheet>

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />
    </div>
  );
}

// PacientesSkeleton se mudó a src/components/esqueletos/pacientes.tsx como
// EsqueletoListaPacientes. Motivo: el loading.tsx de esta ruta necesita el
// mismo dibujo, y un esqueleto que vive dentro de la vista sólo puede
// dibujarse cuando la vista ya se montó — o sea, tarde.

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 flex flex-col items-center text-center">
      <p className="font-display text-[18px] text-ink-900 font-medium">
        No pudimos cargar los pacientes.
      </p>
      <p className="mt-1 text-[13px] text-ink-500">{message}</p>
      <div className="mt-5">
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    </div>
  );
}

function DesktopTable({
  pacientes,
  archived,
  reactivatingId,
  onReactivar,
}: {
  pacientes: PacienteConDeuda[];
  archived: boolean;
  reactivatingId: string | null;
  onReactivar: (paciente: PacienteConDeuda) => void;
}) {
  const cols = archived
    ? "1.8fr 1fr 110px 1fr 140px 24px"
    : "1.8fr 1fr 110px 1fr 120px 24px";

  return (
    <div className="hidden lg:block bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <div
        className="grid items-center bg-cream-50 border-b border-[color:var(--border-subtle)] pl-[22px] pr-5 py-3 gap-4 text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Nombre</span>
        <span>Teléfono</span>
        <span>Tarifa</span>
        <span>Última sesión</span>
        <span>{archived ? "Estado" : "Deuda"}</span>
        <span aria-hidden="true" />
      </div>
      <ListaEnCascada
        contenedor="ul"
        item="li"
        className="divide-y divide-[color:var(--border-subtle)]"
      >
        {pacientes.map((p) => (
          <Link
            key={p.id}
            href={`/pacientes/${p.id}`}
            className="grid items-center pl-5 pr-5 py-[14px] gap-4 text-left transition-colors duration-150 border-l-[2px] border-l-transparent hover:bg-cream-50 hover:border-l-sage-500"
            style={{ gridTemplateColumns: cols }}
          >
            <span className="flex items-center gap-3 min-w-0">
              <Avatar nombre={p.nombre} apellido={p.apellido} size={36} />
              <span className="text-[14px] font-semibold text-ink-900 truncate">
                {p.nombre} {p.apellido}
              </span>
            </span>
            <span className="text-[13px] text-ink-700 tabular-nums">
              {p.telefono}
            </span>
            <span className="text-[13px] text-ink-700 tabular-nums">
              {money(p.tarifa)}
            </span>
            <span className="text-[13px] text-ink-500">
              {p.ultimaSesion ? fechaRelativa(p.ultimaSesion) : "-"}
            </span>
            {archived ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={reactivatingId === p.id}
                icon={<RotateCcw size={14} strokeWidth={1.6} aria-hidden="true" />}
                onClick={(event) => {
                  event.preventDefault();
                  onReactivar(p);
                }}
              >
                {reactivatingId === p.id ? "Reactivando..." : "Reactivar"}
              </Button>
            ) : (
              <span
                className={
                  p.deudaTotal > 0
                    ? "font-display text-[15px] font-medium tabular-nums text-terracotta-600"
                    : "text-[15px] text-ink-300"
                }
              >
                {p.deudaTotal > 0 ? money(p.deudaTotal) : "-"}
              </span>
            )}
            <ChevronRight
              size={16}
              strokeWidth={1.6}
              className="text-ink-300 justify-self-end"
              aria-hidden="true"
            />
          </Link>
        ))}
      </ListaEnCascada>
    </div>
  );
}

function MobileList({
  pacientes,
  archived,
  reactivatingId,
  onReactivar,
}: {
  pacientes: PacienteConDeuda[];
  archived: boolean;
  reactivatingId: string | null;
  onReactivar: (paciente: PacienteConDeuda) => void;
}) {
  return (
    <div className="lg:hidden bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <ListaEnCascada
        contenedor="ul"
        item="li"
        className="divide-y divide-[color:var(--border-subtle)]"
      >
        {pacientes.map((p) => (
          <Link
            key={p.id}
            href={`/pacientes/${p.id}`}
            className="grid items-center gap-4 px-5 py-[14px] transition-colors duration-150 active:bg-cream-50"
            style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto" }}
          >
            <Avatar nombre={p.nombre} apellido={p.apellido} size={40} />
            <span className="flex flex-col min-w-0">
              <span className="break-words text-[15px] font-semibold text-ink-900">
                {p.nombre} {p.apellido}
              </span>
              {/* Sin `truncate`: la segunda línea decía "Hace 3 mes…" por
                  recortar una frase que entra en dos renglones. */}
              <span className="text-[12px] leading-[1.4] text-ink-500">
                {money(p.tarifa)} ·{" "}
                {p.ultimaSesion ? fechaRelativa(p.ultimaSesion) : "-"}
              </span>
              {!archived && p.deudaTotal > 0 ? (
                <Chip variant="terracotta" size="sm" className="mt-1 self-start">
                  {DEBE} {money(p.deudaTotal)}
                </Chip>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {archived ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={reactivatingId === p.id}
                  onClick={(event) => {
                    event.preventDefault();
                    onReactivar(p);
                  }}
                >
                  Reactivar
                </Button>
              ) : null}
              <ChevronRight
                size={16}
                strokeWidth={1.6}
                className="text-ink-300"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </ListaEnCascada>
    </div>
  );
}

function EmptyState({
  kind,
  onCrear,
}: {
  kind: "search" | "noPatients" | "noArchived";
  onCrear: () => void;
}) {
  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 flex flex-col items-center text-center">
      {kind === "search" && (
        <>
          <p className="font-display text-[18px] text-ink-900 font-medium">
            Sin resultados.
          </p>
          <p className="mt-1 text-[13px] text-ink-500">Probá otro nombre.</p>
        </>
      )}
      {kind === "noPatients" && (
        <>
          {/* El único estado vacío de esta pantalla donde entra Lupita: la
              lista sin nadie es una pantalla que enseña el próximo paso, no
              una pantalla clínica (docs/diseno/04-personaje.md). Va a 96 px
              dentro del círculo crema, como manda el documento. */}
          <span className="inline-flex h-[132px] w-[132px] items-center justify-center rounded-full bg-cream-100">
            <Lupita pose="saluda" tamano={TAMANOS_LUPITA.vacio} />
          </span>
          <p className="mt-4 font-display italic text-[22px] text-ink-900 font-medium">
            {PACIENTES_VACIO_TITULO}
          </p>
          <p className="mt-2 max-w-[420px] text-[13px] leading-[1.5] text-ink-500">
            {PACIENTES_VACIO_LINEA}
          </p>
          <div className="mt-5">
            <Button
              onClick={onCrear}
              icon={<Plus size={16} strokeWidth={1.6} aria-hidden="true" />}
            >
              {NUEVO_PACIENTE}
            </Button>
          </div>
        </>
      )}
      {kind === "noArchived" && (
        <>
          <p className="font-display text-[18px] text-ink-900 font-medium">
            No tenés pacientes archivados.
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            Los pacientes que dejan de asistir se archivan, no se borran.
          </p>
        </>
      )}
    </div>
  );
}
