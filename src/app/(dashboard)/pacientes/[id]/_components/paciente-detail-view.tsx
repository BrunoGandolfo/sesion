"use client";

// Ficha del paciente: carga, cabecera, tres pestañas (Sesiones, Recorrido,
// Ficha), un solo sheet de edición y el FAB de grabar.
//
// Acá no se graba ni se revisa: la sesión de hoy se lee por el hook de
// grabación (carga por turno + polling mientras está en el pipeline) y las
// acciones son enlaces a /grabar/[turnoId] y /sesiones/[id].

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Mic } from "lucide-react";
import { isSameDay } from "date-fns";

import { Button, Segmented, Sheet, Toast } from "@/components/ui";
import { useGrabacionSesion } from "@/hooks/useGrabacionSesion";
import { useHoy } from "@/hooks/useHoy";
import { apiGet, esAbort } from "@/lib/api-client";
import { ALGO_FALLO, FICHA, RECORRIDO, SESIONES } from "@/lib/glosario";
import type { Configuracion, Turno } from "@/types/domain";

import {
  fetchConsentimiento,
  fetchFichaPaciente,
  type FichaPaciente,
} from "./api-ficha";
import { CabeceraFicha } from "./cabecera-ficha";
import { EditarPacienteForm } from "./editar-paciente-form";
import { FichaTab } from "./ficha-tab";
import { RecorridoTab } from "./recorrido-tab";
import { SesionesTab } from "./sesiones-tab";

type TabKey = "sesiones" | "recorrido" | "ficha";

const TAB_OPTIONS: { value: TabKey; label: string }[] = [
  { value: "sesiones", label: SESIONES },
  { value: "recorrido", label: RECORRIDO },
  { value: "ficha", label: FICHA },
];

type ToastState = { open: boolean; message: string };

// Ficha atada al id que la cargó: al cambiar de paciente la anterior deja de
// aplicar por derivación, sin resetear estado en un efecto.
type FichaState =
  | { tipo: "cargando"; id: string }
  | { tipo: "lista"; id: string; ficha: FichaPaciente }
  | { tipo: "error"; id: string; mensaje: string };

export function PacienteDetailView({ id }: { id: string }) {
  const [ficha, setFicha] = React.useState<FichaState>({ tipo: "cargando", id });
  const [config, setConfig] = React.useState<Configuracion | null>(null);
  const [consentimiento, setConsentimiento] = React.useState<{
    id: string;
    vigente: boolean;
  } | null>(null);
  const [activeTab, setActiveTab] = React.useState<TabKey>("sesiones");
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editarOpen, setEditarOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>({ open: false, message: "" });

  // Envuelto en useMemo porque es dependencia del useMemo de `turnos`: la
  // rama `{ tipo: "cargando", id }` construye un objeto nuevo en cada render
  // y, sin memo, ese useMemo se recalcularía siempre y propagaría el cambio
  // a todo lo que cuelga de `turnos`.
  const fichaActual = React.useMemo<FichaState>(
    () => (ficha.id === id ? ficha : { tipo: "cargando", id }),
    [ficha, id],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    fetchFichaPaciente(id, { signal: controller.signal })
      .then((data) => setFicha({ tipo: "lista", id, ficha: data }))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        setFicha({
          tipo: "error",
          id,
          mensaje: err instanceof Error ? err.message : ALGO_FALLO,
        });
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<Configuracion>("/api/config", { signal: controller.signal })
      .then(setConfig)
      .catch(() => {
        // Sin configuración la ficha igual funciona: solo faltan nombre y
        // dirección en el texto de la autorización.
      });
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchConsentimiento(id, { signal: controller.signal })
      .then((vigente) => setConsentimiento({ id, vigente: vigente !== null }))
      .catch(() => {
        // Se vuelve a intentar en la próxima recarga.
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  const refetchData = React.useCallback(() => {
    setReloadKey((c) => c + 1);
  }, []);

  // Tras un error, el reintento vuelve al esqueleto en el mismo evento.
  function reintentarCarga() {
    setFicha({ tipo: "cargando", id });
    refetchData();
  }

  const avisar = React.useCallback((mensaje: string) => {
    setToast({ open: true, message: mensaje });
  }, []);

  const paciente = fichaActual.tipo === "lista" ? fichaActual.ficha.paciente : null;
  const turnos = React.useMemo(
    () => (fichaActual.tipo === "lista" ? fichaActual.ficha.turnos : []),
    [fichaActual],
  );

  // Única fuente de "cuándo es ahora" de la ficha. Es null hasta la
  // hidratación, así que en ese render no hay turno de hoy ni próximo turno
  // (tampoco hay turnos todavía: la ficha está cargando).
  const hoy = useHoy();

  const turnoHoy = React.useMemo<Turno | null>(() => {
    if (!hoy) return null;
    const deHoy = turnos
      .filter(
        (t) =>
          (t.estado === "programado" || t.estado === "realizado") &&
          isSameDay(t.fecha, hoy),
      )
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return deHoy[0] ?? null;
  }, [turnos, hoy]);

  const proximoTurno = React.useMemo<Turno | null>(() => {
    if (!hoy) return null;
    const desde = hoy.getTime();
    const futuros = turnos
      .filter((t) => t.estado === "programado" && t.fecha.getTime() >= desde)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return futuros[0] ?? null;
  }, [turnos, hoy]);

  // Sesión de hoy: carga por turno y polling mientras está en el pipeline.
  // Las acciones (iniciar, subir, reintentar) viven en /grabar/[turnoId].
  const { sesionClinica: sesionHoy, loading: sesionHoyCargando } =
    useGrabacionSesion({ turno: turnoHoy, onTurnoActualizado: refetchData });

  const consentimientoVigente =
    consentimiento && consentimiento.id === id ? consentimiento.vigente : null;

  function handleEditarSuccess() {
    setEditarOpen(false);
    avisar("Paciente actualizado");
    refetchData();
  }

  const hrefGrabar = turnoHoy
    ? `/grabar/${turnoHoy.id}`
    : `/grabar/nuevo?pacienteId=${encodeURIComponent(id)}`;

  return (
    <>
      <div className="mx-auto max-w-[1120px] px-5 py-6 lg:px-10 lg:py-8">
        <BackLink />

        {fichaActual.tipo === "cargando" ? <DetailSkeletonInner /> : null}

        {fichaActual.tipo === "error" ? (
          <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white px-6 py-14 text-center">
            <p className="font-display text-[18px] font-medium text-ink-900">
              No pudimos abrir la ficha.
            </p>
            <p className="mt-1 text-[13px] text-ink-500">{fichaActual.mensaje}</p>
            <div className="mt-5">
              <Button variant="secondary" onClick={reintentarCarga}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {paciente ? (
          <div className="flex flex-col gap-6 lg:gap-8">
            <CabeceraFicha
              paciente={paciente}
              proximoTurno={proximoTurno}
              consentimientoVigente={consentimientoVigente}
              config={config}
              reloadKey={reloadKey}
              onEditar={() => setEditarOpen(true)}
              onConsentimientoCambio={refetchData}
            />

            <div className="overflow-x-auto">
              <Segmented
                options={TAB_OPTIONS}
                value={activeTab}
                onChange={setActiveTab}
                ariaLabel="Secciones del paciente"
              />
            </div>

            {activeTab === "sesiones" && (
              <SesionesTab
                pacienteId={paciente.id}
                turnoHoy={turnoHoy}
                sesionHoy={sesionHoy}
                sesionHoyCargando={sesionHoyCargando}
                onTurnoActualizado={refetchData}
                onAviso={avisar}
              />
            )}

            {activeTab === "recorrido" && <RecorridoTab pacienteId={paciente.id} />}

            {activeTab === "ficha" && (
              <FichaTab
                paciente={paciente}
                turnos={turnos}
                config={config}
                reloadKey={reloadKey}
                onPacienteActualizado={refetchData}
              />
            )}
          </div>
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

      <FabGrabar href={hrefGrabar} />

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((c) => ({ ...c, open: false }))}
      />
    </>
  );
}

// Siempre visible. Con turno hoy va a grabar ese turno; sin turno, a grabar
// una sesión nueva para este paciente (contrato de la pantalla de grabación).
function FabGrabar({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="Grabar"
      className="fixed bottom-24 right-5 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-sage-500 pl-4 pr-5 font-sans text-[14px] font-semibold text-white shadow-raised transition-colors duration-150 hover:bg-sage-600 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30 lg:bottom-8 lg:right-8"
    >
      <Mic size={22} strokeWidth={1.9} aria-hidden="true" />
      Grabar
    </Link>
  );
}

function BackLink() {
  return (
    <Link
      href="/pacientes"
      className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
    >
      <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
      <span>Pacientes</span>
    </Link>
  );
}

function DetailSkeletonInner() {
  return (
    <div aria-busy="true">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-cream-200" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="h-8 w-56 rounded-sm bg-cream-200" />
          <div className="h-4 w-full max-w-[520px] rounded-sm bg-cream-100" />
        </div>
      </div>
      <div className="mt-8 h-10 w-full max-w-[420px] rounded-md bg-cream-200" />
      <div className="mt-6 h-[140px] w-full rounded-lg bg-cream-100" />
    </div>
  );
}
