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
import { RiesgoDetectadoBanner } from "@/components/grabacion/RiesgoDetectadoBanner";
import { SesionHuerfanaBanner } from "@/components/grabacion/SesionHuerfanaBanner";
import {
  ErrorSubida,
  subirAudioCifrado,
  type DatosGrabacion,
} from "@/hooks/useGrabacionSesion";
import {
  ESTADOS_ACTIVOS,
  normalizarSesionClinica,
  useSesionClinicaPolling,
  type SesionClinicaApi,
  type SesionClinicaApiBase,
} from "@/hooks/useSesionClinicaPolling";
import { fechaLarga, hora } from "@/lib/format";
import { limpiarGrabacion } from "@/lib/grabacion-storage";
import type {
  EstadoSesion,
  NotaSoap,
} from "@/lib/sesion-clinica/schema";
import { esSesionHuerfana } from "@/lib/sesion-clinica-utils";
import type {
  DatosEstructurados,
  EstadoProcesamiento,
  Modalidad,
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

// Ítem de GET /api/pacientes/[id]/documentacion: la sesión ya viene con la
// nota ensamblada y datosEstructurados parseados en el servidor, más los
// datos del turno. Lo que coincide con el contrato de sesión se toma de ahí.
type DocSesion = Pick<
  SesionClinicaApi,
  "turnoId" | "duracionAudioSeg" | "aprobadoEn" | "procesadoEn"
> & {
  sesionClinicaId: string;
  fecha: string;
  duracionMin: number;
  modalidad: Modalidad;
  estado: Extract<EstadoSesion, "revision" | "aprobado">;
  nota: NotaSoap | null;
  datosEstructurados: DatosEstructurados | null;
};

type DocResponse = {
  pacienteId: string;
  totalSesiones: number;
  sesiones: DocSesion[];
  page: number;
  totalPages: number;
};

const PAGE_SIZE = 10;

type SeccionGrabacion = "idle" | "grabando" | "nota";

// Sesión de hoy atada al turno que la cargó. Si cambia el turno, la sesión,
// la sección y el "cargando" anteriores dejan de aplicar solos (valor
// derivado) sin resetear estado dentro de un efecto.
type SesionHoyState = {
  turnoId: string;
  sesion: SesionClinicaApiBase | null;
  seccion: SeccionGrabacion;
  cargando: boolean;
};

// Timeline atada al paciente que la cargó, por la misma razón.
type DocsState = {
  pacienteId: string;
  docs: DocSesion[];
  totalPages: number;
  totalSesiones: number;
  page: number;
  loading: boolean;
  error: string | null;
};

function docsIniciales(pacienteId: string): DocsState {
  return {
    pacienteId,
    docs: [],
    totalPages: 0,
    totalSesiones: 0,
    page: 1,
    loading: true,
    error: null,
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

// "42 s" por debajo del minuto; "1,4 min" (un decimal, coma es-UY) desde ahí.
function formatDuracionAudio(seg: number): string {
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = seg / 60;
  const conDecimal = min.toFixed(1);
  return conDecimal.endsWith(".0")
    ? `${min.toFixed(0)} min`
    : `${conDecimal.replace(".", ",")} min`;
}

// La duración del turno es la agenda; el audio es lo que realmente se grabó.
// Solo se muestra el audio cuando difiere en más de 20% del turno — mostrar
// "50 min · audio 50 min" sería ruido.
function audioDifiereDelTurno(audioSeg: number, turnoMin: number): boolean {
  if (turnoMin <= 0) return audioSeg > 0;
  const audioMin = audioSeg / 60;
  return Math.abs(audioMin - turnoMin) / turnoMin > 0.2;
}

export function HistoriaTab({
  pacienteId,
  pacienteNombre,
  turnoHoy,
  consentimientoVigente,
  onTurnoActualizado,
}: HistoriaTabProps) {
  // ===== Sesión de hoy (grabación) =====
  const [sesionHoyState, setSesionHoyState] =
    React.useState<SesionHoyState | null>(null);
  const [sesionReloadKey, setSesionReloadKey] = React.useState<number>(0);
  const [grabacionError, setGrabacionError] = React.useState<string | null>(
    null,
  );
  const [grabacionSubmitting, setGrabacionSubmitting] =
    React.useState<boolean>(false);
  // Subida directa a R2 (mismo flujo de tres pasos que useGrabacionSesion):
  // el blob cifrado cuya subida falló queda en memoria para "Reintentar
  // subida"; los chunks de IndexedDB no se borran hasta confirmar.
  const [subidaPendiente, setSubidaPendiente] = React.useState<boolean>(false);
  const [progresoSubida, setProgresoSubida] = React.useState<number | null>(
    null,
  );
  const ultimoAudioRef = React.useRef<DatosGrabacion | null>(null);

  // ===== Timeline (documentación clínica): estado =====
  const [docsState, setDocsState] = React.useState<DocsState>(() =>
    docsIniciales(pacienteId),
  );
  const [reloadKey, setReloadKey] = React.useState<number>(0);

  const turnoHoyId = turnoHoy?.id ?? null;
  const turnoHoyEstado = turnoHoy?.estado ?? null;

  // Valores derivados: solo cuentan si pertenecen al turno de hoy actual.
  const sesionHoyActual =
    sesionHoyState && sesionHoyState.turnoId === turnoHoyId
      ? sesionHoyState
      : null;
  const sesionHoy = sesionHoyActual?.sesion ?? null;
  const seccionGrabacion: SeccionGrabacion =
    sesionHoyActual?.seccion ?? "idle";
  const sesionHoyLoading =
    turnoHoyId !== null &&
    (sesionHoyActual === null || sesionHoyActual.cargando);

  // Actualiza la sesión de hoy bajo el turno vigente al momento de llamar.
  // Si el turno cambió mientras tanto, el valor queda atado al turno viejo
  // y el derivado lo ignora (mismo efecto que el guard `cancelado`).
  function actualizarSesionHoy(
    parcial: Partial<Omit<SesionHoyState, "turnoId">>,
  ) {
    const turnoId = turnoHoyId;
    if (!turnoId) return;
    setSesionHoyState((prev) =>
      prev && prev.turnoId === turnoId
        ? { ...prev, ...parcial }
        : {
            turnoId,
            sesion: null,
            seccion: "idle",
            cargando: false,
            ...parcial,
          },
    );
  }

  // Carga la sesión clínica asociada al turno de hoy (si existe). Mientras
  // no hay resultado para este turno, `sesionHoyLoading` ya es true por
  // derivación; la recarga explícita la marca manejarHuerfanaResuelta.
  React.useEffect(() => {
    if (!turnoHoyId) return;

    let cancelado = false;

    (async () => {
      let sesion: SesionClinicaApiBase | null = null;
      try {
        const res = await fetch(`/api/sesion-clinica?turnoId=${turnoHoyId}`);
        if (cancelado) return;
        if (res.ok) {
          const body = (await res.json()) as {
            data: SesionClinicaApiBase | null;
          };
          sesion = body.data ?? null;
        }
      } catch {
        sesion = null;
      }
      if (cancelado) return;
      setSesionHoyState({
        turnoId: turnoHoyId,
        sesion,
        seccion: "idle",
        cargando: false,
      });
    })();

    return () => {
      cancelado = true;
    };
  }, [turnoHoyId, sesionReloadKey]);

  // Polling mientras la sesión está en pipeline. La fila que devuelve trae
  // el contrato completo (createdAt, audioR2Key incluidos), así que
  // reemplaza a la sesión de hoy sin merge.
  const sesionEnProcesamiento =
    sesionHoy !== null && ESTADOS_ACTIVOS.has(sesionHoy.estado);

  useSesionClinicaPolling({
    sesionClinicaId: sesionEnProcesamiento ? (sesionHoy?.id ?? null) : null,
    enabled: sesionEnProcesamiento,
    onSesion: ({ fila }) => actualizarSesionHoy({ sesion: fila }),
  });

  // Forma que consumen ZonaGrabacion y SesionHuerfanaBanner (nota ensamblada
  // y datosEstructurados validados), más los metadatos del banner.
  const sesionHoyVista = React.useMemo(
    () =>
      sesionHoy
        ? {
            ...normalizarSesionClinica(sesionHoy),
            createdAt: sesionHoy.createdAt,
            audioR2Key: sesionHoy.audioR2Key,
          }
        : null,
    [sesionHoy],
  );

  // Refresco del listado de documentación (timeline): marca la carga en el
  // mismo evento que la dispara.
  function recargarTimeline() {
    setDocsState((prev) =>
      prev.pacienteId === pacienteId
        ? { ...prev, loading: true, error: null }
        : docsIniciales(pacienteId),
    );
    setReloadKey((k) => k + 1);
  }

  async function refrescarSesionHoy() {
    if (!sesionHoy) return;
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionHoy.id}`);
      if (!res.ok) {
        setGrabacionError(await parseError(res));
        return;
      }
      const body = (await res.json()) as { data: SesionClinicaApiBase };
      actualizarSesionHoy({ sesion: body.data, seccion: "idle" });
      // Refrescar la timeline también: una sesión recién aprobada/descartada
      // cambia el listado.
      recargarTimeline();
      onTurnoActualizado?.();
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "No se pudo actualizar la sesión",
      );
    }
  }

  // Aprobación/descarte desde una tarjeta de la timeline (sesión en revisión
  // cuyo turno no es el de hoy): mismo refresco del listado que usa
  // refrescarSesionHoy, sin tocar la sesión de hoy.
  function refrescarTimeline() {
    recargarTimeline();
    onTurnoActualizado?.();
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
      const createBody = (await createRes.json()) as {
        data: SesionClinicaApiBase;
      };
      actualizarSesionHoy({ sesion: createBody.data });

      const patchRes = await fetch(
        `/api/sesion-clinica/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "grabando" }),
        },
      );
      if (!patchRes.ok) throw new Error(await parseError(patchRes));
      const patchBody = (await patchRes.json()) as {
        data: SesionClinicaApiBase;
      };
      actualizarSesionHoy({ sesion: patchBody.data, seccion: "grabando" });
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "No se pudo iniciar la grabación",
      );
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  // Tras un fallo en el PUT a R2 o en la confirmación, la sesión puede haber
  // quedado en "subiendo": se consulta el estado real y, solo si es
  // "subiendo", se la vuelve a "grabando" (transición de cliente permitida)
  // para poder repetir desde upload-url. Si esto también falla, se agrega al
  // error de subida ya visible (no lo reemplaza: el primario es el que
  // explica qué pasó).
  async function volverAGrabando(sesionId: string) {
    const registrarFallo = (detalle: string) =>
      setGrabacionError((prev) =>
        prev
          ? `${prev} No se pudo preparar la sesión para reintentar (${detalle}).`
          : `No se pudo preparar la sesión para reintentar (${detalle}).`,
      );
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        registrarFallo(await parseError(res));
        return;
      }
      const body = (await res.json()) as {
        data: Pick<SesionClinicaApi, "estado"> | null;
      };
      if (body.data?.estado !== "subiendo") return;
      const patchRes = await fetch(`/api/sesion-clinica/${sesionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "grabando" }),
      });
      if (!patchRes.ok) {
        registrarFallo(await parseError(patchRes));
      }
    } catch (err) {
      registrarFallo(err instanceof Error ? err.message : "error de red");
    }
  }

  async function manejarGrabacionCompleta(datos: DatosGrabacion) {
    if (!sesionHoy || !turnoHoyId) return;
    const sesionId = sesionHoy.id;
    const eraProgramado = turnoHoyEstado === "programado";
    ultimoAudioRef.current = datos;
    setGrabacionError(null);
    setGrabacionSubmitting(true);
    setProgresoSubida(null);
    try {
      // Tres pasos, sin pasar el audio por Vercel:
      // upload-url → PUT directo a R2 → upload-confirmar (HeadObject).
      const actualizada = await subirAudioCifrado(sesionId, datos, (p) =>
        setProgresoSubida(p),
      );
      actualizarSesionHoy({ sesion: actualizada });

      // Confirmación OK: el backup incremental en IndexedDB deja de hacer
      // falta (clave = turnoId, fire-and-forget).
      ultimoAudioRef.current = null;
      setSubidaPendiente(false);
      void limpiarGrabacion(turnoHoyId);

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

      actualizarSesionHoy({ seccion: "idle" });
    } catch (err) {
      // Nada se borra: el blob cifrado queda en memoria y los chunks en
      // IndexedDB. La sesión vuelve a "grabando" para repetir desde el
      // paso 1 con el mismo blob ("Reintentar subida" en el grabador).
      setGrabacionError(
        err instanceof Error ? err.message : "Error al subir el audio",
      );
      setSubidaPendiente(true);
      const paso = err instanceof ErrorSubida ? err.paso : "put";
      if (paso !== "url") {
        await volverAGrabando(sesionId);
      }
    } finally {
      setProgresoSubida(null);
      setGrabacionSubmitting(false);
    }
  }

  function reintentarSubida() {
    const datos = ultimoAudioRef.current;
    if (!datos) {
      setGrabacionError(
        "No queda un audio cifrado en memoria para reenviar. Si la grabación quedó guardada en el dispositivo, el grabador la ofrece al volver a entrar.",
      );
      return;
    }
    void manejarGrabacionCompleta(datos);
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
      const body = (await res.json()) as { data: SesionClinicaApiBase };
      actualizarSesionHoy({ sesion: body.data });
    } catch (err) {
      setGrabacionError(
        err instanceof Error ? err.message : "No se pudo reintentar",
      );
    } finally {
      setGrabacionSubmitting(false);
    }
  }

  // ===== Timeline (documentación clínica): carga =====
  const docsActual =
    docsState.pacienteId === pacienteId ? docsState : docsIniciales(pacienteId);
  const {
    docs,
    totalPages: docsTotalPages,
    totalSesiones: docsTotalSesiones,
    page: docsPage,
    loading: docsLoading,
    error: docsError,
  } = docsActual;

  // Carga la primera página. Mientras no hay resultado para este paciente,
  // `loading` ya es true por el estado inicial; las recargas lo marcan en
  // recargarTimeline.
  React.useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/pacientes/${pacienteId}/documentacion?page=1&limit=${PAGE_SIZE}`,
        );
        if (cancelado) return;
        if (!res.ok) throw new Error(await parseError(res));
        const body = (await res.json()) as { data: DocResponse };
        if (cancelado) return;
        setDocsState({
          pacienteId,
          docs: body.data.sesiones,
          totalPages: body.data.totalPages,
          totalSesiones: body.data.totalSesiones,
          page: 1,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelado) return;
        const mensaje =
          err instanceof Error
            ? err.message
            : "No se pudo cargar la documentación";
        setDocsState((prev) => ({
          ...(prev.pacienteId === pacienteId ? prev : docsIniciales(pacienteId)),
          loading: false,
          error: mensaje,
        }));
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [pacienteId, reloadKey]);

  async function cargarMas() {
    const next = docsPage + 1;
    if (next > docsTotalPages) return;
    setDocsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(
        `/api/pacientes/${pacienteId}/documentacion?page=${next}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { data: DocResponse };
      setDocsState((prev) => ({
        ...prev,
        docs: [...prev.docs, ...body.data.sesiones],
        page: next,
        totalPages: body.data.totalPages,
        totalSesiones: body.data.totalSesiones,
        loading: false,
      }));
    } catch (err) {
      setDocsState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "No se pudo cargar más",
      }));
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
    sesionHoyVista !== null &&
    seccionGrabacion === "idle" &&
    esSesionHuerfana(sesionHoyVista)
      ? sesionHoyVista
      : null;

  // Tras descartar/reintentar desde el banner: re-fetch de la sesión por
  // turnoId (un GET por id daría 404 si el DELETE eliminó la fila) y de la
  // timeline. La carga se marca acá, en el evento que la dispara.
  function manejarHuerfanaResuelta() {
    actualizarSesionHoy({ cargando: true, seccion: "idle" });
    setSesionReloadKey((k) => k + 1);
    recargarTimeline();
  }

  // ===== Render =====
  return (
    <div className="flex flex-col gap-8">
      {turnoHoy ? (
        <ZonaGrabacion
          turno={turnoHoy}
          pacienteNombre={pacienteNombre}
          consentimientoVigente={consentimientoVigente}
          sesion={sesionHoyVista}
          sesionHuerfana={sesionHuerfana !== null}
          sesionLoading={sesionHoyLoading}
          seccion={seccionGrabacion}
          submitting={grabacionSubmitting}
          error={grabacionError}
          subidaPendiente={subidaPendiente}
          progresoSubida={progresoSubida}
          onReintentarSubida={reintentarSubida}
          onIniciar={() => void iniciarGrabacionFlow()}
          onGrabacionCompleta={(d) => void manejarGrabacionCompleta(d)}
          onErrorGrabacion={(m) => setGrabacionError(m)}
          onReintentar={() => void reintentarProcesamiento()}
          onAprobado={() => void refrescarSesionHoy()}
          onVerNota={() => actualizarSesionHoy({ seccion: "nota" })}
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
                <SesionTimelineCard
                  sesion={sesion}
                  pacienteNombre={pacienteNombre}
                  // La sesión de hoy en revisión ya se aprueba desde
                  // ZonaGrabacion: mientras se carga (o si coincide el id) la
                  // tarjeta queda en solo lectura para no duplicar "Aprobar".
                  aprobable={
                    !sesionHoyLoading &&
                    sesion.sesionClinicaId !== sesionHoy?.id
                  }
                  onAprobado={refrescarTimeline}
                />
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
  subidaPendiente: boolean;
  progresoSubida: number | null;
  onReintentarSubida: () => void;
  onIniciar: () => void;
  onGrabacionCompleta: (datos: DatosGrabacion) => void;
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
  subidaPendiente,
  progresoSubida,
  onReintentarSubida,
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
          subidaPendiente={subidaPendiente}
          progresoSubida={progresoSubida}
          errorSubida={error}
          onReintentarSubida={onReintentarSubida}
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
          {sesion && !sesionHuerfana && ESTADOS_ACTIVOS.has(sesion.estado) ? (
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

function SesionTimelineCard({
  sesion,
  pacienteNombre,
  aprobable,
  onAprobado,
}: {
  sesion: DocSesion;
  pacienteNombre: string;
  // false cuando la sesión ya se ofrece para aprobar en ZonaGrabacion.
  aprobable: boolean;
  onAprobado: () => void;
}) {
  const [open, setOpen] = React.useState<boolean>(false);
  const fecha = new Date(sesion.fecha);
  const datos = sesion.datosEstructurados;
  const temas = datos?.temas?.slice(0, 5) ?? [];
  const resumen = resumenCorto(datos);
  const esRevision = sesion.estado === "revision";
  // Nota editable con checkboxes de riesgo y "Aprobar nota" (misma vista que
  // "Sesión de hoy"). NotaClinicaView ya incluye el banner de riesgo.
  const mostrarAprobacion = esRevision && aprobable && sesion.nota !== null;
  const duracionAudio =
    typeof sesion.duracionAudioSeg === "number" && sesion.duracionAudioSeg >= 0
      ? sesion.duracionAudioSeg
      : null;
  const mostrarAudio =
    duracionAudio !== null &&
    audioDifiereDelTurno(duracionAudio, sesion.duracionMin);

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
              {hora(fecha)} · {sesion.duracionMin} min
              {mostrarAudio
                ? ` · audio ${formatDuracionAudio(duracionAudio)}`
                : ""}{" "}
              · {sesion.modalidad === "online" ? "Online" : "Presencial"}
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
          {mostrarAprobacion && sesion.nota ? (
            <NotaClinicaView
              sesionClinicaId={sesion.sesionClinicaId}
              nota={sesion.nota}
              datosEstructurados={sesion.datosEstructurados}
              pacienteNombre={pacienteNombre}
              fechaSesion={fechaLarga(fecha)}
              onAprobado={onAprobado}
            />
          ) : (
            <>
              <RiesgoDetectadoBanner
                riesgoDetectado={datos?.riesgoDetectado}
              />
              {sesion.nota ? <NotaSOAPReadOnly nota={sesion.nota} /> : null}
            </>
          )}

          {datos?.feedbackTerapeuta ? (
            <FeedbackTerapeutaView
              feedbackTerapeuta={datos.feedbackTerapeuta}
            />
          ) : null}

          {!mostrarAprobacion && datos ? (
            <DatosExtraidosBloque datos={datos} />
          ) : null}
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
