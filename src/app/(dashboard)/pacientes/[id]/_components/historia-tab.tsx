"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  LoaderCircle,
  Mic,
  Sparkles,
} from "lucide-react";
import { Button, Card, Chip } from "@/components/ui";
import { GrabadorSesion } from "@/components/grabacion/GrabadorSesion";
import { NotaClinicaView } from "@/components/grabacion/NotaClinicaView";
import { FeedbackTerapeutaView } from "@/components/grabacion/FeedbackTerapeutaView";
import { SesionHuerfanaBanner } from "@/components/grabacion/SesionHuerfanaBanner";
import { useSesionClinicaPolling } from "@/hooks/useSesionClinicaPolling";
import { fechaLarga, hora } from "@/lib/format";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";
import type {
  DatosEstructurados,
  EstadoProcesamiento,
  NotaSOAP,
  SesionClinicaResponse,
  Turno,
} from "@/types/domain";

interface HistoriaTabProps {
  pacienteId: string;
  pacienteNombre: string;
  turnoHoy: Turno | null;
  consentimientoVigente: boolean;
  onTurnoActualizado?: () => void;
}

type RawSesionClinica = {
  id: string;
  turnoId: string;
  estado: string;
  duracionAudioSeg: number | null;
  // Presentes en el GET por turnoId (y en las filas crudas de POST/PATCH);
  // opcionales porque SesionClinicaResponse no los garantiza.
  createdAt?: string | null;
  audioR2Key?: string | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  datosEstructurados: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
};

type DocSesion = {
  sesionClinicaId: string;
  turnoId: string;
  fecha: string;
  duracionMin: number;
  modalidad: "presencial" | "online";
  estado: "revision" | "aprobado";
  nota: NotaSOAP | null;
  datosEstructurados: DatosEstructurados | null;
  aprobadoEn: string | null;
  procesadoEn: string | null;
};

type DocResponse = {
  pacienteId: string;
  totalSesiones: number;
  sesiones: DocSesion[];
  page: number;
  totalPages: number;
};

const PAGE_SIZE = 10;

function parseDatosEstructurados(
  value: DatosEstructurados | string | null,
): DatosEstructurados | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DatosEstructurados;
    } catch {
      return null;
    }
  }
  return value;
}

// createdAt/audioR2Key no viven en SesionClinicaResponse pero el banner de
// sesión huérfana los necesita: createdAt para el umbral de abandono y
// audioR2Key para decidir si ofrece reintentar.
type SesionClinicaConMetadatos = SesionClinicaResponse & {
  createdAt?: string | null;
  audioR2Key?: string | null;
};

function toSesionClinicaResponse(
  raw: RawSesionClinica,
): SesionClinicaConMetadatos {
  const nota: NotaSOAP | null =
    raw.notaSubjetivo !== null &&
    raw.notaObjetivo !== null &&
    raw.notaAnalisis !== null &&
    raw.notaPlan !== null
      ? {
          subjetivo: raw.notaSubjetivo,
          objetivo: raw.notaObjetivo,
          analisis: raw.notaAnalisis,
          plan: raw.notaPlan,
        }
      : null;

  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado as EstadoProcesamiento,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota,
    datosEstructurados: parseDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
    createdAt: raw.createdAt ?? null,
    audioR2Key: raw.audioR2Key ?? null,
  };
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `HTTP ${res.status}`;
}

function chipDeProcesamiento(estado: EstadoProcesamiento): {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
} {
  switch (estado) {
    case "grabando":
      return { variant: "terracotta", label: "Grabando…" };
    case "subiendo":
      return { variant: "gold", label: "Subiendo audio…" };
    case "procesando":
      return { variant: "gold", label: "Procesando con IA…" };
    case "revision":
      return { variant: "sage", label: "Lista para revisar" };
    case "aprobado":
      return { variant: "sage", label: "Sesión documentada ✓" };
    case "error":
      return { variant: "terracotta", label: "Error en el procesamiento" };
    default:
      return { variant: "neutral", label: "Pendiente" };
  }
}

function resumenCorto(datos: DatosEstructurados | null): string {
  if (!datos?.resumenSesion) return "";
  const t = datos.resumenSesion.trim();
  return t.length > 200 ? `${t.slice(0, 200).trimEnd()}…` : t;
}

export function HistoriaTab({
  pacienteId,
  pacienteNombre,
  turnoHoy,
  consentimientoVigente,
  onTurnoActualizado,
}: HistoriaTabProps) {
  // ===== Sesión de hoy (grabación) =====
  const [sesionHoy, setSesionHoy] =
    React.useState<SesionClinicaConMetadatos | null>(null);
  const [sesionHoyLoading, setSesionHoyLoading] = React.useState<boolean>(
    Boolean(turnoHoy),
  );
  const [sesionReloadKey, setSesionReloadKey] = React.useState<number>(0);
  const [seccionGrabacion, setSeccionGrabacion] = React.useState<
    "idle" | "grabando" | "nota"
  >("idle");
  const [grabacionError, setGrabacionError] = React.useState<string | null>(
    null,
  );
  const [grabacionSubmitting, setGrabacionSubmitting] =
    React.useState<boolean>(false);

  const turnoHoyId = turnoHoy?.id ?? null;
  const turnoHoyEstado = turnoHoy?.estado ?? null;

  // Carga la sesión clínica asociada al turno de hoy (si existe)
  React.useEffect(() => {
    if (!turnoHoyId) {
      setSesionHoy(null);
      setSesionHoyLoading(false);
      setSeccionGrabacion("idle");
      return;
    }

    let cancelado = false;
    setSesionHoyLoading(true);
    setSeccionGrabacion("idle");

    (async () => {
      try {
        const res = await fetch(`/api/sesion-clinica?turnoId=${turnoHoyId}`);
        if (cancelado) return;
        if (res.ok) {
          const body = (await res.json()) as { data: RawSesionClinica | null };
          setSesionHoy(body.data ? toSesionClinicaResponse(body.data) : null);
        } else {
          setSesionHoy(null);
        }
      } catch {
        if (!cancelado) setSesionHoy(null);
      } finally {
        if (!cancelado) setSesionHoyLoading(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [turnoHoyId, sesionReloadKey]);

  // Polling mientras la sesión está en pipeline
  const sesionEnProcesamiento =
    sesionHoy !== null &&
    (sesionHoy.estado === "grabando" ||
      sesionHoy.estado === "subiendo" ||
      sesionHoy.estado === "procesando");

  const { data: sesionPolled } = useSesionClinicaPolling({
    sesionClinicaId: sesionEnProcesamiento ? sesionHoy?.id ?? null : null,
    enabled: sesionEnProcesamiento,
  });

  React.useEffect(() => {
    if (sesionPolled) {
      // El polling normaliza a SesionClinicaResponse (sin createdAt ni
      // audioR2Key); merge sobre el estado previo para no perder los
      // metadatos que usa la detección de sesión huérfana.
      setSesionHoy((prev) =>
        prev && prev.id === sesionPolled.id
          ? { ...prev, ...sesionPolled }
          : sesionPolled,
      );
    }
  }, [sesionPolled]);

  async function refrescarSesionHoy() {
    if (!sesionHoy) return;
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionHoy.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionHoy(toSesionClinicaResponse(body.data));
      setSeccionGrabacion("idle");
      // Refrescar la timeline también: una sesión recién aprobada/descartada
      // cambia el listado.
      setReloadKey((k) => k + 1);
      onTurnoActualizado?.();
    } catch {
      // tragar
    }
  }

  async function iniciarGrabacionFlow() {
    if (!turnoHoyId) return;
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      const createRes = await fetch("/api/sesion-clinica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId: turnoHoyId }),
      });
      if (!createRes.ok) throw new Error(await parseError(createRes));
      const createBody = (await createRes.json()) as { data: RawSesionClinica };
      setSesionHoy(toSesionClinicaResponse(createBody.data));

      const patchRes = await fetch(
        `/api/sesion-clinica/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "grabando" }),
        },
      );
      if (!patchRes.ok) throw new Error(await parseError(patchRes));
      const patchBody = (await patchRes.json()) as { data: RawSesionClinica };
      setSesionHoy(toSesionClinicaResponse(patchBody.data));
      setSeccionGrabacion("grabando");
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "No se pudo iniciar la grabación",
      );
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  async function manejarGrabacionCompleta(datos: {
    audioBlob: Blob;
    claveCifrado: string;
    ivCifrado: string;
    duracionSegundos: number;
  }) {
    if (!sesionHoy || !turnoHoyId) return;
    const sesionId = sesionHoy.id;
    const eraProgramado = turnoHoyEstado === "programado";
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      // El endpoint /upload acepta entrada desde "grabando" y persiste en la
      // misma transacción duracionAudioSeg + estado "procesando".
      const formData = new FormData();
      formData.append("audio", datos.audioBlob, "sesion.bin");
      formData.append("claveCifrado", datos.claveCifrado);
      formData.append("iv", datos.ivCifrado);
      formData.append("duracionSegundos", String(datos.duracionSegundos));

      const uploadRes = await fetch(
        `/api/sesion-clinica/${sesionId}/upload`,
        { method: "POST", body: formData },
      );
      if (!uploadRes.ok) throw new Error(await parseError(uploadRes));

      // Auto-cierre del turno cuando se grabó durante uno programado.
      if (eraProgramado) {
        try {
          const turnoRes = await fetch(`/api/turnos/${turnoHoyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: "realizado" }),
          });
          if (!turnoRes.ok) {
            console.warn(
              "No se pudo marcar el turno como realizado tras grabar:",
              await parseError(turnoRes),
            );
          }
        } catch (turnoErr) {
          console.warn("Error PATCH del turno post-grabación:", turnoErr);
        }
        onTurnoActualizado?.();
      }

      setSeccionGrabacion("idle");
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "Error al subir el audio",
      );
      // Best-effort: marcar como error.
      try {
        await fetch(`/api/sesion-clinica/${sesionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "error" }),
        });
      } catch {
        // tragar
      }
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  async function reintentarProcesamiento() {
    if (!sesionHoy) return;
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionHoy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "procesando" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionHoy(toSesionClinicaResponse(body.data));
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "No se pudo reintentar",
      );
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  // ===== Timeline (documentación clínica) =====
  const [docs, setDocs] = React.useState<DocSesion[]>([]);
  const [docsTotalPages, setDocsTotalPages] = React.useState<number>(0);
  const [docsTotalSesiones, setDocsTotalSesiones] = React.useState<number>(0);
  const [docsPage, setDocsPage] = React.useState<number>(1);
  const [docsLoading, setDocsLoading] = React.useState<boolean>(true);
  const [docsError, setDocsError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState<number>(0);

  React.useEffect(() => {
    let cancelado = false;
    setDocsLoading(true);
    setDocsError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/pacientes/${pacienteId}/documentacion?page=1&limit=${PAGE_SIZE}`,
        );
        if (cancelado) return;
        if (!res.ok) throw new Error(await parseError(res));
        const body = (await res.json()) as { data: DocResponse };
        setDocs(body.data.sesiones);
        setDocsTotalPages(body.data.totalPages);
        setDocsTotalSesiones(body.data.totalSesiones);
        setDocsPage(1);
      } catch (err) {
        if (!cancelado) {
          setDocsError(
            err instanceof Error
              ? err.message
              : "No se pudo cargar la documentación",
          );
        }
      } finally {
        if (!cancelado) setDocsLoading(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [pacienteId, reloadKey]);

  async function cargarMas() {
    const next = docsPage + 1;
    if (next > docsTotalPages) return;
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch(
        `/api/pacientes/${pacienteId}/documentacion?page=${next}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { data: DocResponse };
      setDocs((prev) => [...prev, ...body.data.sesiones]);
      setDocsPage(next);
      setDocsTotalPages(body.data.totalPages);
      setDocsTotalSesiones(body.data.totalSesiones);
    } catch (err) {
      setDocsError(
        err instanceof Error ? err.message : "No se pudo cargar más",
      );
    } finally {
      setDocsLoading(false);
    }
  }

  // Evita duplicar la sesión de hoy en la timeline mientras está en revisión:
  // arriba ya se renderiza para aprobar/descartar.
  const docsVisibles = React.useMemo(() => {
    if (!sesionHoy || sesionHoy.estado === "aprobado") return docs;
    return docs.filter((d) => d.sesionClinicaId !== sesionHoy.id);
  }, [docs, sesionHoy]);

  // ===== Sesión huérfana =====
  // Única candidata: la sesión del turno de hoy (la timeline de documentación
  // solo trae revision/aprobado, nunca huérfanas). El guard de seccion evita
  // mostrar el banner mientras el grabador está montado (grabación activa).
  const sesionHuerfana =
    sesionHoy !== null &&
    seccionGrabacion === "idle" &&
    esSesionHuerfana(sesionHoy)
      ? sesionHoy
      : null;

  // Tras descartar/reintentar desde el banner: re-fetch de la sesión por
  // turnoId (un GET por id daría 404 si el DELETE eliminó la fila) y de la
  // timeline.
  function manejarHuerfanaResuelta() {
    setSesionReloadKey((k) => k + 1);
    setReloadKey((k) => k + 1);
  }

  // ===== Render =====
  return (
    <div className="flex flex-col gap-8">
      {turnoHoy ? (
        <ZonaGrabacion
          turno={turnoHoy}
          pacienteNombre={pacienteNombre}
          consentimientoVigente={consentimientoVigente}
          sesion={sesionHoy}
          sesionHuerfana={sesionHuerfana !== null}
          sesionLoading={sesionHoyLoading}
          seccion={seccionGrabacion}
          submitting={grabacionSubmitting}
          error={grabacionError}
          onIniciar={() => void iniciarGrabacionFlow()}
          onGrabacionCompleta={(d) => void manejarGrabacionCompleta(d)}
          onErrorGrabacion={(m) => setGrabacionError(m)}
          onReintentar={() => void reintentarProcesamiento()}
          onAprobado={() => void refrescarSesionHoy()}
          onVerNota={() => setSeccionGrabacion("nota")}
        />
      ) : null}

      {sesionHuerfana ? (
        <SesionHuerfanaBanner
          sesion={sesionHuerfana}
          onResuelta={manejarHuerfanaResuelta}
        />
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[20px] font-medium tracking-[-0.01em] text-ink-900">
            Documentación clínica
          </h2>
          {docsTotalSesiones > 0 ? (
            <span className="font-sans text-[12px] text-ink-500">
              {docsTotalSesiones}{" "}
              {docsTotalSesiones === 1 ? "sesión" : "sesiones"}
            </span>
          ) : null}
        </div>

        {docsError ? (
          <p className="font-sans text-[13px] text-[color:var(--color-error)]">
            {docsError}
          </p>
        ) : null}

        {docsLoading && docs.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-500">Cargando…</p>
        ) : null}

        {!docsLoading && docs.length === 0 && !docsError ? (
          <Card className="border-[color:var(--border-subtle)]">
            <p className="font-sans text-[14px] leading-[1.6] text-ink-500">
              Todavía no hay sesiones grabadas. Cuando grabes tu primera
              sesión, la documentación aparecerá acá.
            </p>
          </Card>
        ) : null}

        {docsVisibles.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {docsVisibles.map((sesion) => (
              <li key={sesion.sesionClinicaId}>
                <SesionTimelineCard sesion={sesion} />
              </li>
            ))}
          </ul>
        ) : null}

        {docsPage < docsTotalPages ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              onClick={() => void cargarMas()}
              disabled={docsLoading}
            >
              {docsLoading ? "Cargando…" : "Cargar más"}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface ZonaGrabacionProps {
  turno: Turno;
  pacienteNombre: string;
  consentimientoVigente: boolean;
  sesion: SesionClinicaResponse | null;
  // Cuando es true, el banner de sesión huérfana (renderizado por HistoriaTab)
  // es el único punto de acción: acá se ocultan el chip de estado, el spinner
  // de pipeline y el bloque de error para no duplicar mensajes.
  sesionHuerfana: boolean;
  sesionLoading: boolean;
  seccion: "idle" | "grabando" | "nota";
  submitting: boolean;
  error: string | null;
  onIniciar: () => void;
  onGrabacionCompleta: (datos: {
    audioBlob: Blob;
    claveCifrado: string;
    ivCifrado: string;
    duracionSegundos: number;
  }) => void;
  onErrorGrabacion: (mensaje: string) => void;
  onReintentar: () => void;
  onAprobado: () => void;
  onVerNota: () => void;
}

function ZonaGrabacion({
  turno,
  pacienteNombre,
  consentimientoVigente,
  sesion,
  sesionHuerfana,
  sesionLoading,
  seccion,
  submitting,
  error,
  onIniciar,
  onGrabacionCompleta,
  onErrorGrabacion,
  onReintentar,
  onAprobado,
  onVerNota,
}: ZonaGrabacionProps) {
  return (
    <section className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-[color:var(--border-subtle)] bg-cream-50/95 px-4 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:rounded-lg sm:border sm:bg-white sm:px-5 sm:py-5 sm:backdrop-blur-none">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Sesión de hoy
          </span>
          <span className="font-sans text-[13px] text-ink-700 tabular-nums">
            {hora(turno.fecha)} · {turno.duracion} min ·{" "}
            {turno.modalidad === "online" ? "Online" : "Presencial"}
          </span>
        </div>
        {sesion && !sesionHuerfana ? (
          <Chip
            variant={chipDeProcesamiento(sesion.estado).variant}
            size="sm"
          >
            {chipDeProcesamiento(sesion.estado).label}
          </Chip>
        ) : null}
      </div>

      {/* Grabador montado: la única razón para que esté en seccion="grabando" */}
      {seccion === "grabando" && sesion ? (
        <GrabadorSesion
          turnoId={turno.id}
          pacienteNombre={pacienteNombre}
          onGrabacionCompleta={onGrabacionCompleta}
          onError={onErrorGrabacion}
        />
      ) : null}

      {/* Vista forzada de la nota tras aprobar (reapertura) */}
      {seccion === "nota" && sesion && sesion.nota ? (
        <NotaClinicaView
          sesionClinicaId={sesion.id}
          nota={sesion.nota}
          datosEstructurados={sesion.datosEstructurados}
          pacienteNombre={pacienteNombre}
          fechaSesion={fechaLarga(turno.fecha)}
          onAprobado={onAprobado}
        />
      ) : null}

      {seccion === "idle" ? (
        <>
          {sesionLoading ? (
            <p className="font-sans text-[13px] text-ink-500">Cargando…</p>
          ) : null}

          {/* Sin consentimiento — bloquea grabación */}
          {!sesionLoading && !consentimientoVigente && sesion === null ? (
            <div className="flex items-start gap-3 rounded-md border border-gold-50 bg-gold-50 px-3 py-3">
              <AlertTriangle
                size={18}
                strokeWidth={1.9}
                aria-hidden="true"
                className="mt-[2px] shrink-0 text-gold-500"
              />
              <p className="font-sans text-[13px] leading-[1.5] text-ink-700">
                Para grabar esta sesión, primero hay que firmar el
                consentimiento informado en la pestaña <strong>Datos</strong>.
              </p>
            </div>
          ) : null}

          {/* Sin sesión + con consentimiento → CTA principal */}
          {!sesionLoading && consentimientoVigente && sesion === null ? (
            <Button
              icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={onIniciar}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Grabar sesión
            </Button>
          ) : null}

          {/* En pipeline */}
          {sesion &&
          !sesionHuerfana &&
          (sesion.estado === "grabando" ||
            sesion.estado === "subiendo" ||
            sesion.estado === "procesando") ? (
            <div className="flex items-center gap-3 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-3">
              <LoaderCircle
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                className="shrink-0 animate-spin text-sage-500"
              />
              <span className="font-sans text-[13px] text-ink-700">
                {chipDeProcesamiento(sesion.estado).label}
              </span>
            </div>
          ) : null}

          {/* Lista para revisar — la nota se renderiza inline */}
          {sesion && sesion.estado === "revision" && sesion.nota ? (
            <NotaClinicaView
              sesionClinicaId={sesion.id}
              nota={sesion.nota}
              datosEstructurados={sesion.datosEstructurados}
              pacienteNombre={pacienteNombre}
              fechaSesion={fechaLarga(turno.fecha)}
              onAprobado={onAprobado}
            />
          ) : null}

          {/* Aprobada — chip + reapertura */}
          {sesion && sesion.estado === "aprobado" ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-sage-200 bg-sage-50 px-3 py-2">
              <Chip variant="sage" size="sm">
                Sesión documentada ✓
              </Chip>
              {sesion.nota ? (
                <Button variant="ghost" size="sm" onClick={onVerNota}>
                  Ver nota
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Error en pipeline (si es huérfana lo resuelve el banner) */}
          {sesion && !sesionHuerfana && sesion.estado === "error" ? (
            <div className="flex flex-col gap-2 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3">
              <Chip variant="terracotta" size="sm">
                Error en el procesamiento
              </Chip>
              {sesion.error ? (
                <p className="font-sans text-[13px] text-ink-500">
                  {sesion.error}
                </p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={onReintentar}
                disabled={submitting}
              >
                Reintentar
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="font-sans text-[12px] text-[color:var(--color-error)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SesionTimelineCard({ sesion }: { sesion: DocSesion }) {
  const [open, setOpen] = React.useState<boolean>(false);
  const fecha = new Date(sesion.fecha);
  const datos = sesion.datosEstructurados;
  const temas = datos?.temas?.slice(0, 5) ?? [];
  const resumen = resumenCorto(datos);
  const esRevision = sesion.estado === "revision";

  return (
    <Card className="border-[color:var(--border-subtle)] !p-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col gap-3 px-4 py-4 text-left sm:px-5"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-[15px] font-medium text-ink-900">
              {fechaLarga(fecha)}
            </span>
            <span className="font-sans text-[12px] text-ink-500 tabular-nums">
              {hora(fecha)} · {sesion.duracionMin} min ·{" "}
              {sesion.modalidad === "online" ? "Online" : "Presencial"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {esRevision ? (
              <Chip variant="gold" size="sm">
                Pendiente de aprobación
              </Chip>
            ) : (
              <Chip variant="sage" size="sm">
                Aprobada
              </Chip>
            )}
            <ChevronDown
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`shrink-0 text-ink-500 transition-transform duration-150 ${
                open ? "rotate-180" : ""
              }`}
            />
          </div>
        </div>

        {resumen ? (
          <p className="font-sans text-[14px] leading-[1.55] text-ink-700">
            {resumen}
          </p>
        ) : null}

        {temas.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {temas.map((t, i) => (
              <Chip key={`${t}-${i}`} variant="neutral" size="sm">
                {t}
              </Chip>
            ))}
          </div>
        ) : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-5 border-t border-[color:var(--border-subtle)] px-4 py-5 sm:px-5">
          {sesion.nota ? <NotaSOAPReadOnly nota={sesion.nota} /> : null}

          {datos?.feedbackTerapeuta ? (
            <FeedbackTerapeutaView
              feedbackTerapeuta={datos.feedbackTerapeuta}
            />
          ) : null}

          {datos ? <DatosExtraidosBloque datos={datos} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function NotaSOAPReadOnly({ nota }: { nota: NotaSOAP }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Nota clínica (SOAP)
      </p>
      <SOAPCampo label="Subjetivo (S)" value={nota.subjetivo} />
      <SOAPCampo label="Objetivo (O)" value={nota.objetivo} />
      <SOAPCampo label="Análisis (A)" value={nota.analisis} />
      <SOAPCampo label="Plan (P)" value={nota.plan} />
    </div>
  );
}

function SOAPCampo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <p className="whitespace-pre-wrap rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-2 font-sans text-[14px] leading-[1.6] text-ink-900">
        {value || "—"}
      </p>
    </div>
  );
}

function DatosExtraidosBloque({ datos }: { datos: DatosEstructurados }) {
  const intervenciones = datos.intervenciones ?? [];
  const speech = datos.speechAnalytics;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className="text-gold-500"
        />
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Datos extraídos
        </span>
      </div>

      {datos.emocionesPaciente?.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Emociones del paciente
          </span>
          <div className="flex flex-wrap gap-1.5">
            {datos.emocionesPaciente.map((e, i) => (
              <Chip key={`${e}-${i}`} variant="sage" size="sm">
                {e}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {intervenciones.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Intervenciones
          </span>
          <ul className="flex flex-col gap-2">
            {intervenciones.map((iv, i) => (
              <li
                key={`int-${i}`}
                className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <Chip variant="neutral" size="sm">
                    {iv.tipo.replace(/_/g, " ")}
                  </Chip>
                  {iv.timestampAprox ? (
                    <span className="font-sans text-[12px] tabular-nums text-ink-500">
                      ~{iv.timestampAprox}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-sans text-[13px] leading-[1.55] text-ink-900">
                  {iv.descripcion}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {speech ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Speech analytics
          </span>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-sans text-[13px] text-ink-700 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-ink-500">Habla terapeuta</dt>
              <dd className="tabular-nums text-ink-900">
                {speech.ratioHablaTerapeuta}%
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-500">Habla paciente</dt>
              <dd className="tabular-nums text-ink-900">
                {speech.ratioHablaPaciente}%
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-500">Silencios</dt>
              <dd className="tabular-nums text-ink-900">
                {speech.cantidadSilencios}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-500">Prom. silencio</dt>
              <dd className="tabular-nums text-ink-900">
                {speech.duracionPromedioSilenciosSeg.toFixed(1)}s
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
