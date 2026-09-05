"use client";

import * as React from "react";
import { AlertTriangle, Plus, Sparkles, X } from "lucide-react";

import { Button, Card, Chip } from "@/components/ui";
import { apiGet, apiPatch, esAbort } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaCompleta, fechaCorta } from "@/lib/format";
import {
  ALGO_FALLO,
  EL_HILO,
  EL_RECORRIDO_HASTA_HOY,
  SENALES_ANTERIORES,
  pluralizar,
} from "@/lib/glosario";

// ────────────────────────────────────────────────────────────────────────────
// Tipos del payload — espejan exactamente la response de
// GET /api/pacientes/[id]/contexto-clinico (route.ts).
// ────────────────────────────────────────────────────────────────────────────

type EstadoObjetivo = "activo" | "cerrado" | "pausado";
type Eficacia = "alta" | "media" | "baja";

interface Objetivo {
  id: string;
  descripcion: string;
  estado: EstadoObjetivo;
  fechaInicio: string;
  fechaCierre?: string | null;
}

interface Intervencion {
  tecnica: string;
  eficaciaPercibida: Eficacia;
  sesiones: number[];
}

interface Tema {
  tema: string;
  conteo: number;
}

interface RiesgoHistorico {
  sesionId: string;
  fecha: string;
  flag: string;
  detalle?: string;
}

interface NotaResumen {
  sesionClinicaId: string;
  numero: number;
  fechaSesion: string;
  notaAnalisis: string | null;
  notaPlan: string | null;
}

interface ContextoPayload {
  pacienteId: string;
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  objetivosTerapeuticos: Objetivo[];
  intervencionesProbadas: Intervencion[];
  temasRecurrentes: Tema[];
  riesgosHistoricos: RiesgoHistorico[];
  ultimaSesionId: string | null;
  version: number;
  aprobadoPorTerapeutaEn: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
  ultimasNotas: NotaResumen[];
  totalSesionesAprobadas: number;
}

interface ContextoGoldenThreadViewProps {
  pacienteId: string;
  onContextoActualizado?: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Labels y mappings visuales
// ────────────────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<EstadoObjetivo, string> = {
  activo: "Activo",
  cerrado: "Cerrado",
  pausado: "Pausado",
};

const ESTADO_TONE: Record<EstadoObjetivo, "sage" | "neutral" | "gold"> = {
  activo: "sage",
  cerrado: "neutral",
  pausado: "gold",
};

const EFICACIA_TONE: Record<Eficacia, "sage" | "gold" | "terracotta"> = {
  alta: "sage",
  media: "gold",
  baja: "terracotta",
};

function parseFechaISO(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatFechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = parseFechaISO(iso);
  return d ? fechaCorta(d) : iso.slice(0, 10);
}

/** "4 de marzo de 2026". Las señales anteriores pueden ser de hace años: la
 *  fecha corta ("4 mar") no alcanza para ubicarlas en el proceso. El formato
 *  vive en @/lib/format (fechaCompleta); acá solo se resuelve el ISO. */
function formatFechaCompleta(iso: string): string {
  const d = parseFechaISO(iso);
  if (!d) return iso.slice(0, 10);
  return fechaCompleta(d);
}

function nuevoObjetivoId(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Body que se envía al PATCH. Mismo shape que `updateSchema` en route.ts.
// ────────────────────────────────────────────────────────────────────────────

interface PatchBody {
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  objetivosTerapeuticos: Objetivo[];
  intervencionesProbadas: Intervencion[];
  temasRecurrentes: Tema[];
  riesgosHistoricos: RiesgoHistorico[];
}

// ────────────────────────────────────────────────────────────────────────────
// Carga
// ────────────────────────────────────────────────────────────────────────────

const MENSAJE_ERROR_CARGA = "No pudimos cargar el hilo. Intentá de nuevo.";

function cargarContexto(
  pacienteId: string,
  signal: AbortSignal,
): Promise<ContextoPayload> {
  return apiGet<ContextoPayload>(`/api/pacientes/${pacienteId}/contexto-clinico`, {
    signal,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────────────────────────

export function ContextoGoldenThreadView({
  pacienteId,
  onContextoActualizado,
}: ContextoGoldenThreadViewProps) {
  const [data, setData] = React.useState<ContextoPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editando, setEditando] = React.useState(false);
  const [guardando, setGuardando] = React.useState(false);
  const [errorGuardado, setErrorGuardado] = React.useState<string | null>(null);

  // Buffer de edición — se inicializa desde `data` al entrar a edit mode.
  const [draft, setDraft] = React.useState<PatchBody | null>(null);

  // No resetea loading/error acá: el estado inicial ya es "cargando" y el
  // reintento lo hace en su propio handler (ver `reintentar`).
  React.useEffect(() => {
    const controller = new AbortController();

    cargarContexto(pacienteId, controller.signal)
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setError(err instanceof Error ? err.message : MENSAJE_ERROR_CARGA);
        setLoading(false);
      });

    return () => controller.abort();
  }, [pacienteId, reloadKey]);

  const reintentar = () => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const entrarEdicion = () => {
    if (!data) return;
    setDraft({
      hipotesisDiagnostica: data.hipotesisDiagnostica,
      resumenAcumulativo: data.resumenAcumulativo,
      objetivosTerapeuticos: [...(data.objetivosTerapeuticos ?? [])],
      intervencionesProbadas: [...(data.intervencionesProbadas ?? [])],
      temasRecurrentes: [...(data.temasRecurrentes ?? [])],
      riesgosHistoricos: [...(data.riesgosHistoricos ?? [])],
    });
    setErrorGuardado(null);
    setEditando(true);
  };

  const cancelarEdicion = () => {
    setDraft(null);
    setErrorGuardado(null);
    setEditando(false);
  };

  const guardarYAprobar = async () => {
    if (!draft) return;
    setGuardando(true);
    setErrorGuardado(null);
    try {
      const actualizado = await apiPatch<ContextoPayload>(
        `/api/pacientes/${pacienteId}/contexto-clinico`,
        draft,
      );
      setData(actualizado);
      setDraft(null);
      setEditando(false);
      onContextoActualizado?.();
    } catch (err) {
      setErrorGuardado(err instanceof Error ? err.message : ALGO_FALLO);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) {
    return <SkeletonView />;
  }

  if (error) {
    return <ErrorView mensaje={error} onRetry={reintentar} />;
  }

  if (!data) {
    return null;
  }

  // Empty state: nunca se grabó una sesión y no hay contexto cargado a mano.
  if (data.creadoEn === null && data.totalSesionesAprobadas === 0) {
    return <EmptyView />;
  }

  return (
    <ContextoBody
      data={data}
      editando={editando}
      draft={draft}
      setDraft={setDraft}
      guardando={guardando}
      errorGuardado={errorGuardado}
      onEditar={entrarEdicion}
      onCancelar={cancelarEdicion}
      onAprobar={guardarYAprobar}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Body principal
// ────────────────────────────────────────────────────────────────────────────

interface ContextoBodyProps {
  data: ContextoPayload;
  editando: boolean;
  draft: PatchBody | null;
  setDraft: React.Dispatch<React.SetStateAction<PatchBody | null>>;
  guardando: boolean;
  errorGuardado: string | null;
  onEditar: () => void;
  onCancelar: () => void;
  onAprobar: () => void;
}

function ContextoBody({
  data,
  editando,
  draft,
  setDraft,
  guardando,
  errorGuardado,
  onEditar,
  onCancelar,
  onAprobar,
}: ContextoBodyProps) {
  const aprobado = data.aprobadoPorTerapeutaEn !== null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {EL_HILO}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {aprobado ? (
              <Chip variant="sage">Revisado</Chip>
            ) : (
              <Chip variant="gold">Actualizado tras la última sesión · revisalo</Chip>
            )}
          </div>
          <p className="font-sans text-[13px] text-ink-500">
            {pluralizar(
              data.totalSesionesAprobadas,
              "sesión aprobada",
              "sesiones aprobadas",
            )}{" "}
            hasta hoy.
          </p>
        </div>

        {!editando && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onEditar}
          >
            Editar
          </Button>
        )}
      </header>

      {!aprobado && !editando && (
        <div className="flex items-start gap-2 rounded-md border border-gold-50 bg-gold-50 px-3 py-3">
          <Sparkles
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-gold-500"
          />
          <p className="font-sans text-[13px] leading-[1.5] text-gold-500">
            Lo escribió la IA después de la última sesión. Revisalo y guardalo
            para que quede como el hilo del proceso.
          </p>
        </div>
      )}

      <SectionHipotesis
        valor={editando ? (draft?.hipotesisDiagnostica ?? null) : data.hipotesisDiagnostica}
        editando={editando}
        onChange={(v) =>
          setDraft((d) =>
            d ? { ...d, hipotesisDiagnostica: v.trim() === "" ? null : v } : d,
          )
        }
      />

      <SectionObjetivos
        objetivos={
          editando
            ? (draft?.objetivosTerapeuticos ?? [])
            : (data.objetivosTerapeuticos ?? [])
        }
        editando={editando}
        onChange={(objetivos) =>
          setDraft((d) => (d ? { ...d, objetivosTerapeuticos: objetivos } : d))
        }
      />

      <SectionIntervenciones
        intervenciones={
          editando
            ? (draft?.intervencionesProbadas ?? [])
            : (data.intervencionesProbadas ?? [])
        }
      />

      <SectionTemas
        temas={
          editando
            ? (draft?.temasRecurrentes ?? [])
            : (data.temasRecurrentes ?? [])
        }
        editando={editando}
        onChange={(temas) =>
          setDraft((d) => (d ? { ...d, temasRecurrentes: temas } : d))
        }
      />

      <SectionResumen resumen={data.resumenAcumulativo} />

      <SectionRiesgos riesgos={data.riesgosHistoricos ?? []} />

      {errorGuardado && (
        <p
          role="alert"
          className="font-sans text-[14px] text-[color:var(--color-error)]"
        >
          {errorGuardado}
        </p>
      )}

      {editando && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancelar}
            disabled={guardando}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onAprobar}
            disabled={guardando}
            className="w-full sm:w-auto"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Secciones
// ────────────────────────────────────────────────────────────────────────────

function SectionTitulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-[18px] italic font-medium text-ink-900">
      {children}
    </h3>
  );
}

function SectionEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-[13px] italic text-ink-500">{children}</p>
  );
}

function SectionHipotesis({
  valor,
  editando,
  onChange,
}: {
  valor: string | null;
  editando: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SectionTitulo>Hipótesis diagnóstica</SectionTitulo>
        {editando ? (
          <textarea
            value={valor ?? ""}
            onChange={(event) => onChange(event.target.value)}
            rows={3}
            placeholder="Hipótesis de trabajo, formulación clínica…"
            className="bg-cream-100 border border-[color:var(--border-subtle)] rounded-md px-4 py-3 font-sans text-[14px] leading-[1.6] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-sage-500/20 resize-none"
          />
        ) : valor ? (
          <p className="font-sans text-[14px] leading-[1.7] text-ink-900 whitespace-pre-wrap">
            {valor}
          </p>
        ) : (
          <SectionEmpty>Sin hipótesis registrada todavía.</SectionEmpty>
        )}
      </div>
    </Card>
  );
}

function SectionObjetivos({
  objetivos,
  editando,
  onChange,
}: {
  objetivos: Objetivo[];
  editando: boolean;
  onChange: (objetivos: Objetivo[]) => void;
}) {
  const [nuevo, setNuevo] = React.useState("");

  const setEstado = (id: string, estado: EstadoObjetivo) => {
    onChange(
      objetivos.map((o) =>
        o.id === id
          ? {
              ...o,
              estado,
              fechaCierre:
                estado === "cerrado"
                  ? new Date().toISOString()
                  : estado === "activo"
                    ? null
                    : o.fechaCierre,
            }
          : o,
      ),
    );
  };

  const agregar = () => {
    const descripcion = nuevo.trim();
    if (!descripcion) return;
    onChange([
      ...objetivos,
      {
        id: nuevoObjetivoId(),
        descripcion,
        estado: "activo",
        fechaInicio: new Date().toISOString(),
        fechaCierre: null,
      },
    ]);
    setNuevo("");
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SectionTitulo>Objetivos terapéuticos</SectionTitulo>

        {objetivos.length === 0 && !editando && (
          <SectionEmpty>Todavía no hay objetivos definidos.</SectionEmpty>
        )}

        {objetivos.length > 0 && (
          <ul className="flex flex-col gap-2">
            {objetivos.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-sans text-[14px] leading-[1.5] text-ink-900">
                    {o.descripcion}
                  </p>
                  <p className="font-sans text-[12px] text-ink-500">
                    Inicio {formatFechaCorta(o.fechaInicio) ?? "—"}
                    {o.estado === "cerrado" && o.fechaCierre && (
                      <> · cerrado {formatFechaCorta(o.fechaCierre)}</>
                    )}
                  </p>
                </div>

                {editando ? (
                  <select
                    value={o.estado}
                    onChange={(event) =>
                      setEstado(o.id, event.target.value as EstadoObjetivo)
                    }
                    className="bg-white border border-[color:var(--border-subtle)] rounded-md px-3 py-2 font-sans text-[13px] text-ink-900 outline-none focus-visible:border-sage-500 focus-visible:ring-[3px] focus-visible:ring-sage-500/20"
                    aria-label={`Estado de "${o.descripcion}"`}
                  >
                    <option value="activo">Activo</option>
                    <option value="pausado">Pausado</option>
                    <option value="cerrado">Cerrado</option>
                  </select>
                ) : (
                  <Chip variant={ESTADO_TONE[o.estado]} size="sm">
                    {ESTADO_LABEL[o.estado]}
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        )}

        {editando && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={nuevo}
              onChange={(event) => setNuevo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  agregar();
                }
              }}
              placeholder="Nuevo objetivo…"
              className="flex-1 bg-white border border-[color:var(--border-subtle)] rounded-md px-3 py-2 font-sans text-[14px] text-ink-900 outline-none focus-visible:border-sage-500 focus-visible:ring-[3px] focus-visible:ring-sage-500/20"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={agregar}
              icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
            >
              Agregar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function SectionIntervenciones({
  intervenciones,
}: {
  intervenciones: Intervencion[];
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SectionTitulo>Intervenciones probadas</SectionTitulo>
        {intervenciones.length === 0 ? (
          <SectionEmpty>
            Las intervenciones se acumulan automáticamente sesión a sesión.
          </SectionEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {intervenciones.map((i, idx) => (
              <li
                key={`${i.tecnica}-${idx}`}
                className="flex flex-col gap-2 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="font-sans text-[14px] leading-[1.5] text-ink-900">
                  {formatearEtiqueta(i.tecnica)}
                </p>
                <div className="flex items-center gap-2">
                  <Chip variant={EFICACIA_TONE[i.eficaciaPercibida]} size="sm">
                    Eficacia {i.eficaciaPercibida}
                  </Chip>
                  <span className="font-sans text-[12px] text-ink-500">
                    {i.sesiones?.length ?? 0} sesión
                    {(i.sesiones?.length ?? 0) === 1 ? "" : "es"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function SectionTemas({
  temas,
  editando,
  onChange,
}: {
  temas: Tema[];
  editando: boolean;
  onChange: (temas: Tema[]) => void;
}) {
  const [nuevo, setNuevo] = React.useState("");
  const ordenados = React.useMemo(
    () => [...temas].sort((a, b) => b.conteo - a.conteo),
    [temas],
  );

  const eliminar = (tema: string) => {
    onChange(temas.filter((t) => t.tema !== tema));
  };

  const agregar = () => {
    const tema = nuevo.trim();
    if (!tema) return;
    if (temas.some((t) => t.tema.toLowerCase() === tema.toLowerCase())) {
      setNuevo("");
      return;
    }
    onChange([...temas, { tema, conteo: 1 }]);
    setNuevo("");
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SectionTitulo>Temas recurrentes</SectionTitulo>
        {ordenados.length === 0 && !editando && (
          <SectionEmpty>Todavía no se detectaron temas recurrentes.</SectionEmpty>
        )}
        {ordenados.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ordenados.map((t) => (
              <span
                key={t.tema}
                className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-[10px] py-[3px] font-sans text-[12px] text-ink-700"
              >
                <span className="font-semibold">{formatearEtiqueta(t.tema)}</span>
                <span className="text-ink-500">· {t.conteo}</span>
                {editando && (
                  <button
                    type="button"
                    onClick={() => eliminar(t.tema)}
                    aria-label={`Quitar tema ${t.tema}`}
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-500 hover:bg-cream-200 hover:text-ink-700"
                  >
                    <X size={11} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {editando && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={nuevo}
              onChange={(event) => setNuevo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  agregar();
                }
              }}
              placeholder="Nuevo tema…"
              className="flex-1 bg-white border border-[color:var(--border-subtle)] rounded-md px-3 py-2 font-sans text-[14px] text-ink-900 outline-none focus-visible:border-sage-500 focus-visible:ring-[3px] focus-visible:ring-sage-500/20"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={agregar}
              icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
            >
              Agregar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function SectionResumen({ resumen }: { resumen: string | null }) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionTitulo>{EL_RECORRIDO_HASTA_HOY}</SectionTitulo>
          <Chip variant="gold" size="sm">
            Generado por IA
          </Chip>
        </div>
        {resumen ? (
          <p className="font-sans text-[14px] leading-[1.7] text-ink-900 whitespace-pre-wrap">
            {resumen}
          </p>
        ) : (
          <SectionEmpty>
            El resumen se va construyendo a medida que se aprueban sesiones.
          </SectionEmpty>
        )}
      </div>
    </Card>
  );
}

function SectionRiesgos({ riesgos }: { riesgos: RiesgoHistorico[] }) {
  // Por fecha, de la más reciente a la más vieja, comparando como fecha y no
  // como texto: los ISO conviven con formatos sin normalizar y el orden
  // alfabético los mezcla.
  const ordenados = React.useMemo(
    () =>
      [...riesgos].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
      ),
    [riesgos],
  );

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SectionTitulo>{SENALES_ANTERIORES}</SectionTitulo>
        {ordenados.length === 0 ? (
          <SectionEmpty>Sin riesgos registrados en sesiones previas.</SectionEmpty>
        ) : (
          <ol className="flex flex-col gap-3">
            {ordenados.map((r, idx) => (
              <li
                key={`${r.sesionId}-${r.flag}-${idx}`}
                className="flex items-start gap-3 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3"
              >
                <AlertTriangle
                  size={18}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="mt-[2px] shrink-0 text-terracotta-500"
                />
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip variant="terracotta" size="sm">
                      {formatearEtiqueta(r.flag)}
                    </Chip>
                    <span className="font-sans text-[12px] tabular-nums text-ink-500">
                      {formatFechaCompleta(r.fecha)}
                    </span>
                  </div>
                  {r.detalle && (
                    <p className="font-sans text-[13px] leading-[1.6] text-ink-900">
                      {r.detalle}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Estados de carga / error / vacío
// ────────────────────────────────────────────────────────────────────────────

function SkeletonView() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Cargando contexto clínico…</span>
      <div className="h-5 w-48 rounded-md bg-cream-100 animate-pulse" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-6 md:p-7"
        >
          <div className="flex flex-col gap-3">
            <div className="h-4 w-40 rounded bg-cream-100 animate-pulse" />
            <div className="h-3 w-full rounded bg-cream-100 animate-pulse" />
            <div className="h-3 w-5/6 rounded bg-cream-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorView({
  mensaje,
  onRetry,
}: {
  mensaje: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-3" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={20}
            strokeWidth={1.8}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
          <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
            {mensaje}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    </Card>
  );
}

function EmptyView() {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Sparkles
          size={28}
          strokeWidth={1.6}
          aria-hidden="true"
          className="text-sage-500"
        />
        <h2 className="font-display text-[20px] italic font-medium text-ink-900">
          Todavía no hay hilo para este paciente.
        </h2>
        <p className="max-w-[420px] font-sans text-[14px] leading-[1.6] text-ink-500">
          Se generará automáticamente después de la primera sesión grabada y
          aprobada.
        </p>
      </div>
    </Card>
  );
}
