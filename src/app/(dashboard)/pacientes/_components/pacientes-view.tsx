"use client";

import { AccesoConsultorio } from "@/components/layout/cabecera-usuario";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { Plus, Search } from "lucide-react";
import {
  Button,
  Fab,
  Input,
  Segmented,
  Sheet,
  Toast,
} from "@/components/ui";
import { EsqueletoListaPacientes } from "@/components/esqueletos";
import { esAbort, mensajeParaElla } from "@/lib/api-client";
import { NUEVO_PACIENTE, CARGANDO } from "@/lib/glosario";
import type { PacienteConDeuda } from "@/types/domain";
import { NuevoPacienteForm } from "./nuevo-paciente-form";
import {
  DesktopTable,
  EmptyState,
  ErrorState,
  MobileList,
} from "./lista-pacientes";
import {
  conPaciente,
  leerPacientes,
  leerTarifaDefault,
  reactivarPaciente as pedirReactivacion,
  tipoDeVacio,
  type Segment,
} from "./pacientes-datos";

export function PacientesView({
  archivedToast = false,
}: {
  archivedToast?: boolean;
}) {
  const [segment, setSegment] = React.useState<Segment>("activos");
  // El segmento de la lista que se está mostrando, que no es el elegido
  // mientras llega la nueva: con el elegido, al pasar a Archivados los
  // activos aparecían un momento con "Reactivar" (forense 03, P3-21).
  const [segmentoDeLaLista, setSegmentoDeLaLista] = React.useState<Segment>(segment);
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
  const toast = useToast();
  const { avisar, confirmar } = toast;
  // Se llega desde la ficha después de archivar (?archivado=1).
  React.useEffect(() => {
    if (archivedToast) confirmar("Paciente archivado");
  }, [archivedToast, confirmar]);

  const openNuevoPaciente = React.useCallback(() => {
    setShowNuevoPaciente(true);
    if (tarifaCargada) return;
    void leerTarifaDefault().then((tarifa) => {
      // Sin configuración no hay tarifa sugerida: el campo queda vacío.
      setTarifaDefault(tarifa);
      setTarifaCargada(true);
    });
  }, [tarifaCargada]);
  const closeNuevoPaciente = React.useCallback(
    () => setShowNuevoPaciente(false),
    [],
  );
  const handleNuevoPacienteSuccess = React.useCallback(() => {
    setShowNuevoPaciente(false);
    confirmar("Paciente creado");
    setSegment("activos");
    setReloadKey((current) => current + 1);
  }, [confirmar]);

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

    leerPacientes({
      segment,
      query: debouncedQuery,
      signal: controller.signal,
    })
      .then((data) => {
        setPacientes(data);
        setSegmentoDeLaLista(segment);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setError(mensajeParaElla(err));
        setLoading(false);
      });

    return () => controller.abort();
  }, [segment, debouncedQuery, reloadKey]);

  async function reactivarPaciente(paciente: PacienteConDeuda) {
    setReactivatingId(paciente.id);
    setPacientes((current) => current.filter((item) => item.id !== paciente.id));

    try {
      await pedirReactivacion(paciente.id);
      confirmar("Paciente reactivado");
    } catch (err) {
      setPacientes((current) => conPaciente(current, paciente));
      avisar(mensajeParaElla(err));
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

  const emptyKind = tipoDeVacio(pacientes.length, debouncedQuery, segmentoDeLaLista);

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
            archived={segmentoDeLaLista === "archivados"}
            reactivatingId={reactivatingId}
            onReactivar={reactivarPaciente}
          />
          <MobileList
            pacientes={pacientes}
            archived={segmentoDeLaLista === "archivados"}
            reactivatingId={reactivatingId}
            onReactivar={reactivarPaciente}
          />
        </div>
      )}

      {/* El FAB es fijo y opaco: sin este colchón tapaba la última fila de
          la lista. */}
      <div aria-hidden="true" className="h-24 lg:hidden" />

      <Fab label={NUEVO_PACIENTE} onClick={openNuevoPaciente} />

      <Sheet
        open={showNuevoPaciente}
        onClose={closeNuevoPaciente}
        ariaLabel={NUEVO_PACIENTE}
        formulario
      >
          {tarifaCargada ? (
            <NuevoPacienteForm
              tarifaDefault={tarifaDefault}
              onSuccess={handleNuevoPacienteSuccess}
              onCancel={closeNuevoPaciente}
            />
          ) : (
            <p className="py-16 text-center text-[14px] text-ink-500">
              {CARGANDO}
            </p>
          )}
      </Sheet>

      <Toast {...toast.props} />
    </div>
  );
}

// PacientesSkeleton se mudó a src/components/esqueletos/pacientes.tsx como
// EsqueletoListaPacientes. Motivo: el loading.tsx de esta ruta necesita el
// mismo dibujo, y un esqueleto que vive dentro de la vista sólo puede
// dibujarse cuando la vista ya se montó — o sea, tarde.
