"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, EditorialRule } from "@/components/ui";

import {
  contieneTerminosDeterioro,
  lecturaAlianza,
  lecturaIntensidad,
  lecturaIntervenciones,
  lecturaRatioHabla,
  lecturaTemas,
  topTemas,
  type Lectura,
  type TonoLectura,
} from "./progreso-lecturas";

const COLOR = {
  sage: "#4F7A6A",
  sageSoft: "#C2D4CB",
  terracotta: "#B26B45",
  terracottaSoft: "#F5E0CC",
  gold: "#A88534",
  goldSoft: "#FAF4E4",
  cream: "#FAFAF6",
  ink: "#1A2628",
  inkSoft: "#A5B0B2",
  mint: "#5DCAA5",
  gray: "#C2C8C9",
} as const;

type FlagsRiesgo = {
  ideacionSuicida?: boolean;
  autolesion?: boolean;
  [key: string]: boolean | undefined;
};

type SpeechAnalytics = {
  ratioHablaTerapeuta: number;
  ratioHablaPaciente: number;
  cantidadSilencios: number;
  duracionPromedioSilenciosSeg: number;
  tiempoTotalHablaSeg: number;
  speakersDetectados?: number; // ausente en payloads previos al campo
};

type SesionProgreso = {
  fecha: string;
  numero: number;
  intensidadEmocional: number;
  alianzaTerapeutica: number;
  alianzaLabel: string;
  temas: string[];
  intervenciones: Record<string, number>;
  flagsRiesgo?: FlagsRiesgo;
  speechAnalytics?: SpeechAnalytics;
  observacionIA?: string;
  progresoPercibido?: string | null;
};

type ProgresoResponse = {
  pacienteId: string;
  nombre: string;
  apellido: string;
  totalSesiones: number;
  sesiones: SesionProgreso[];
};

type LoadState = "loading" | "ready" | "error";

const MENSAJE_ERROR_CARGA = "No pudimos cargar el progreso. Intentá de nuevo.";

async function fetchProgreso(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<ProgresoResponse> {
  const response = await fetch(`/api/pacientes/${pacienteId}/progreso`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Paciente no encontrado."
        : MENSAJE_ERROR_CARGA,
    );
  }
  const json = (await response.json()) as ProgresoResponse;
  return json;
}

export function ProgresoClinico({ pacienteId }: { pacienteId: string }) {
  const [data, setData] = React.useState<ProgresoResponse | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    setError(null);

    fetchProgreso(pacienteId, controller.signal)
      .then((next) => {
        setData(next);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Ante un fallo nunca se muestran datos: los gráficos anteriores se
        // descartan para no mezclar un estado viejo con un error actual.
        setData(null);
        setError(err instanceof Error ? err.message : MENSAJE_ERROR_CARGA);
        setLoadState("error");
      });

    return () => controller.abort();
  }, [pacienteId, reloadKey]);

  function retry() {
    setReloadKey((k) => k + 1);
  }

  if (loadState === "loading") {
    return <ProgresoSkeleton />;
  }

  if (loadState === "error" || error) {
    return <ErrorState mensaje={error ?? MENSAJE_ERROR_CARGA} onRetry={retry} />;
  }

  if (!data) return null;

  const sesiones = Array.isArray(data.sesiones) ? data.sesiones : [];
  const totalSesiones = data.totalSesiones ?? sesiones.length;

  if (totalSesiones === 0) {
    return <EmptyState variante="sin-sesiones" />;
  }

  if (totalSesiones < 3) {
    return <EmptyState variante="poco-recorrido" />;
  }

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <ProgresoDestacado sesiones={sesiones} />
      <FlagsRiesgoTimeline sesiones={sesiones} />
      <IntensidadChart sesiones={sesiones} />
      <AlianzaChart sesiones={sesiones} />
      <TemasTable sesiones={sesiones} />
      <IntervencionesChart sesiones={sesiones} />
      <RatioHablaChart sesiones={sesiones} />
      <ObservacionIA sesiones={sesiones} />
    </div>
  );
}

function ProgresoSkeleton() {
  return (
    <div className="flex flex-col gap-5 lg:gap-6" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-5"
        >
          <div className="h-4 w-40 rounded-sm bg-cream-200" />
          <div className="mt-2 h-3 w-64 max-w-full rounded-sm bg-cream-100" />
          <div className="mt-5 h-[140px] w-full rounded-sm bg-cream-100" />
        </div>
      ))}
    </div>
  );
}

// Mismo patrón que ErrorView en ContextoGoldenThreadView: Card + ícono +
// mensaje corto + "Reintentar". Nunca se muestran datos junto al error.
function ErrorState({
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

const EMPTY_STATE_TEXTOS = {
  "sin-sesiones": {
    titulo: "Todavía no hay sesiones para mirar en perspectiva.",
    detalle:
      "Cuando grabes y apruebes las primeras sesiones, acá vas a ver cómo evoluciona el recorrido.",
  },
  "poco-recorrido": {
    titulo: "Todavía no hay suficiente recorrido.",
    detalle:
      "Los gráficos de progreso aparecen a partir de la tercera sesión grabada.",
  },
} as const;

function EmptyState({
  variante,
}: {
  variante: keyof typeof EMPTY_STATE_TEXTOS;
}) {
  const textos = EMPTY_STATE_TEXTOS[variante];
  return (
    <div className="rounded-lg border border-dashed border-[color:var(--border-strong,#C2D4CB)] bg-cream-50 px-6 py-10 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        aria-hidden="true"
        className="mx-auto text-sage-500"
        fill="none"
      >
        <path
          d="M8 36 L18 24 L26 30 L40 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 4"
        />
        <circle cx="40" cy="12" r="2.5" fill="currentColor" />
      </svg>
      <p className="mt-4 font-[family-name:var(--font-display)] text-[18px] font-medium italic text-ink-900">
        {textos.titulo}
      </p>
      <p className="mt-2 text-[13px] leading-[1.5] text-ink-500">
        {textos.detalle}
      </p>
    </div>
  );
}

// ============================================
// Progreso percibido (card destacada)
// ============================================
function ProgresoDestacado({ sesiones }: { sesiones: SesionProgreso[] }) {
  const ultima = [...sesiones]
    .reverse()
    .find(
      (s) => s.progresoPercibido && s.progresoPercibido.trim().length > 0,
    );
  if (!ultima) return null;

  const texto = (ultima.progresoPercibido ?? "").trim();
  const alerta = contieneTerminosDeterioro(texto);

  return (
    <section
      className={
        alerta
          ? "rounded-lg border border-terracotta-100 border-l-2 border-l-terracotta-500 bg-terracotta-50/40 p-4 lg:p-5"
          : "rounded-lg border border-[color:var(--border-subtle)] border-l-2 border-l-sage-500 bg-cream-50 p-4 lg:p-5"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Progreso percibido — Sesión {ultima.numero}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[17px] italic leading-[1.5] text-ink-900">
        «{texto}»
      </p>
    </section>
  );
}

const LECTURA_ACCENT: Record<TonoLectura, string> = {
  positivo: COLOR.sage,
  neutral: COLOR.inkSoft,
  atencion: COLOR.terracotta,
};

function ChartCard({
  title,
  subtitle,
  lectura,
  children,
}: {
  title: string;
  subtitle: string;
  lectura?: Lectura | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-4 lg:p-5">
      <header className="mb-4">
        <h3 className="font-[family-name:var(--font-display)] text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
          {title}
        </h3>
        <p className="mt-1 text-[12px] leading-[1.4] text-ink-500">{subtitle}</p>
      </header>
      {lectura ? (
        <p
          className="mb-4 border-l-2 pl-3 text-[13px] leading-[1.55] text-ink-900"
          style={{ borderLeftColor: LECTURA_ACCENT[lectura.tono] }}
        >
          {lectura.texto}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function sessionLabels(sesiones: SesionProgreso[]): string[] {
  return sesiones.map((s) => `S${s.numero}`);
}

// ============================================
// 0. Flags de riesgo (timeline por sesión)
// ============================================
const FLAG_KEYS = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
] as const;

const FLAG_LABELS: Record<(typeof FLAG_KEYS)[number], string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Riesgo a terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

function FlagsRiesgoTimeline({ sesiones }: { sesiones: SesionProgreso[] }) {
  const activeFlags = FLAG_KEYS.filter((key) =>
    sesiones.some((s) => s.flagsRiesgo?.[key] === true),
  );
  if (activeFlags.length === 0) return null;

  return (
    <section className="rounded-lg border border-terracotta-100 bg-terracotta-50/40 p-4 lg:p-5">
      <header className="mb-4 flex items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-terracotta-500"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
            Flags de riesgo
          </h3>
          <p className="mt-1 text-[12px] leading-[1.4] text-ink-500">
            Sesiones donde la IA detectó señales de riesgo clínico. Permanecen
            visibles y nunca se ocultan silenciosamente.
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-terracotta-50/40 py-2 pr-3 text-left font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500">
                Flag
              </th>
              {sesiones.map((s) => (
                <th
                  key={s.numero}
                  className="px-1 py-2 text-center font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500"
                >
                  S{s.numero}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeFlags.map((flag) => (
              <tr
                key={flag}
                className="border-t border-[color:var(--border-subtle)]"
              >
                <td className="sticky left-0 z-[1] bg-terracotta-50/40 py-2 pr-3 text-ink-900">
                  {FLAG_LABELS[flag]}
                </td>
                {sesiones.map((s) => {
                  const present = s.flagsRiesgo?.[flag] === true;
                  return (
                    <td
                      key={s.numero}
                      className="px-1 py-2 text-center text-[16px] leading-none tabular-nums"
                      aria-label={
                        present
                          ? `${FLAG_LABELS[flag]} detectada en S${s.numero}`
                          : `Sin ${FLAG_LABELS[flag].toLowerCase()} en S${s.numero}`
                      }
                    >
                      <span
                        style={{
                          color: present ? COLOR.terracotta : COLOR.inkSoft,
                        }}
                      >
                        {present ? "🚩" : "○"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================
// 1. Intensidad emocional (LineChart)
// ============================================
function IntensidadChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const values = sesiones.map((s) => s.intensidadEmocional);
  const labels = sessionLabels(sesiones);
  const lectura = lecturaIntensidad(values);

  return (
    <ChartCard
      title="Intensidad emocional"
      subtitle="Cómo se siente al iniciar cada sesión (1 a 10). La baja sostenida indica mejora."
      lectura={lectura}
    >
      <LineChart
        values={values}
        labels={labels}
        yMin={0}
        yMax={10}
        yTicks={[0, 2, 4, 6, 8, 10]}
        color={COLOR.terracotta}
        fillColor={COLOR.terracottaSoft}
        ariaLabel="Intensidad emocional por sesión"
      />
    </ChartCard>
  );
}

// ============================================
// 2. Alianza terapéutica (LineChart)
// ============================================
const ALIANZA_LABELS = ["", "Frágil", "Inestable", "Estable", "Fuerte"];

function AlianzaChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const values = sesiones.map((s) => s.alianzaTerapeutica);
  const labels = sessionLabels(sesiones);
  const drops: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) drops.push(i);
  }
  const lectura = lecturaAlianza(
    sesiones.map((s) => ({
      nivel: s.alianzaTerapeutica,
      etiqueta: s.alianzaLabel,
    })),
  );

  return (
    <ChartCard
      title="Alianza terapéutica"
      subtitle="Calidad del vínculo en cada sesión. Las caídas marcadas en terracotta son posibles rupturas."
      lectura={lectura}
    >
      <LineChart
        values={values}
        labels={labels}
        yMin={1}
        yMax={4}
        yTicks={[1, 2, 3, 4]}
        yLabels={ALIANZA_LABELS}
        color={COLOR.sage}
        fillColor="rgba(79,122,106,0.12)"
        rupturas={drops}
        ariaLabel="Alianza terapéutica por sesión"
      />
    </ChartCard>
  );
}

// ============================================
// LineChart genérico
// ============================================
function LineChart({
  values,
  labels,
  yMin,
  yMax,
  yTicks,
  yLabels,
  color,
  fillColor,
  rupturas,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  yLabels?: string[];
  color: string;
  fillColor: string;
  rupturas?: number[];
  ariaLabel: string;
}) {
  const W = 600;
  const H = 220;
  const padL = yLabels ? 78 : 36;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = values.length;
  const xFor = (i: number) =>
    n === 1 ? padL + innerW / 2 : padL + (i * innerW) / (n - 1);
  const yFor = (v: number) =>
    padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const points = values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
  const areaPath =
    n > 0
      ? `M ${xFor(0)},${padT + innerH} L ${values
          .map((v, i) => `${xFor(i)},${yFor(v)}`)
          .join(" L ")} L ${xFor(n - 1)},${padT + innerH} Z`
      : "";

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full min-w-[320px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="#E8E1D2"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={yFor(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#627072"
              fontFamily="var(--font-sans)"
            >
              {yLabels ? yLabels[t] ?? t : t}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={fillColor} />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {values.map((v, i) => {
          const isRuptura = rupturas?.includes(i);
          return (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(v)}
              r={isRuptura ? 4.5 : 3}
              fill={isRuptura ? COLOR.terracotta : color}
              stroke="white"
              strokeWidth={1.5}
            />
          );
        })}

        {labels.map((label, i) => (
          <text
            key={i}
            x={xFor(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#627072"
            fontFamily="var(--font-sans)"
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ============================================
// 3. Temas recurrentes (Tabla)
// ============================================
function TemasTable({ sesiones }: { sesiones: SesionProgreso[] }) {
  const temasPorSesion = sesiones.map((s) => s.temas ?? []);
  const ordenados = topTemas(temasPorSesion, Infinity);

  if (ordenados.length === 0) {
    return (
      <ChartCard
        title="Temas recurrentes"
        subtitle="Qué temas se repiten a lo largo del recorrido."
      >
        <p className="py-6 text-center text-[13px] text-ink-500">
          Aún no hay temas registrados.
        </p>
      </ChartCard>
    );
  }

  const lectura = lecturaTemas(temasPorSesion);
  const top = ordenados.slice(0, 5);
  const totalSesiones = sesiones.length;

  return (
    <ChartCard
      title="Temas recurrentes"
      subtitle="Qué temas se repiten a lo largo del recorrido."
      lectura={lectura}
    >
      <ul>
        {top.map((t) => (
          <li
            key={t.tema}
            className="flex items-baseline justify-between gap-3 border-t border-[color:var(--border-subtle)] py-2 first:border-t-0"
          >
            <span className="text-[13px] capitalize text-ink-900">
              {t.tema}
            </span>
            <span className="text-[12px] tabular-nums text-ink-500">
              {t.apariciones} de {totalSesiones}{" "}
              {totalSesiones === 1 ? "sesión" : "sesiones"}
            </span>
          </li>
        ))}
      </ul>

      <details className="mt-4">
        <summary className="cursor-pointer text-[12px] font-medium text-sage-500">
          Ver detalle por sesión
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-white py-2 pr-3 text-left font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500">
                  Tema
                </th>
                {sesiones.map((s) => (
                  <th
                    key={s.numero}
                    className="px-1 py-2 text-center font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500"
                  >
                    S{s.numero}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenados.map(({ tema }) => (
                <tr
                  key={tema}
                  className="border-t border-[color:var(--border-subtle)]"
                >
                  <td className="sticky left-0 z-[1] bg-white py-2 pr-3 text-ink-900 capitalize">
                    {tema}
                  </td>
                  {sesiones.map((s) => {
                    const present = (s.temas ?? []).includes(tema);
                    return (
                      <td
                        key={s.numero}
                        className="px-1 py-2 text-center text-[16px] leading-none tabular-nums"
                        aria-label={
                          present
                            ? `${tema} apareció en S${s.numero}`
                            : `${tema} no apareció en S${s.numero}`
                        }
                      >
                        <span
                          style={{
                            color: present ? COLOR.sage : COLOR.inkSoft,
                          }}
                        >
                          {present ? "●" : "○"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </ChartCard>
  );
}

// ============================================
// 4. Intervenciones (StackedBarChart)
// ============================================
const INTERVENCION_COLORS: Record<string, string> = {
  validacion: COLOR.sage,
  reformulacion: COLOR.gold,
  senalamiento: COLOR.mint,
  confrontacion: COLOR.terracotta,
  otros: COLOR.gray,
};

const INTERVENCION_LABELS: Record<string, string> = {
  validacion: "Validación",
  reformulacion: "Reformulación",
  senalamiento: "Señalamiento",
  confrontacion: "Confrontación",
  otros: "Otros",
};

function normalizeKey(k: string): string {
  const lower = k.toLowerCase();
  if (lower in INTERVENCION_COLORS) return lower;
  return "otros";
}

function IntervencionesChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const aggregated = sesiones.map((s) => {
    const buckets: Record<string, number> = {
      validacion: 0,
      reformulacion: 0,
      senalamiento: 0,
      confrontacion: 0,
      otros: 0,
    };
    for (const [k, v] of Object.entries(s.intervenciones ?? {})) {
      buckets[normalizeKey(k)] += v;
    }
    return buckets;
  });

  const totals = aggregated.map((b) =>
    Object.values(b).reduce((a, b) => a + b, 0),
  );
  const maxTotal = Math.max(...totals, 1);
  const tickStep = Math.max(1, Math.ceil(maxTotal / 4));
  const yTop = Math.ceil(maxTotal / tickStep) * tickStep;
  const yTicks: number[] = [];
  for (let v = 0; v <= yTop; v += tickStep) yTicks.push(v);

  const keys = ["validacion", "reformulacion", "senalamiento", "confrontacion", "otros"];
  const labels = sessionLabels(sesiones);
  const lectura = lecturaIntervenciones(aggregated, INTERVENCION_LABELS);

  return (
    <ChartCard
      title="Intervenciones del terapeuta"
      subtitle="Cantidad y tipo de intervenciones por sesión."
      lectura={lectura}
    >
      <StackedBarChart
        labels={labels}
        keys={keys}
        keyLabels={INTERVENCION_LABELS}
        keyColors={INTERVENCION_COLORS}
        data={aggregated}
        yTicks={yTicks}
        yMax={yTop}
        ariaLabel="Intervenciones por sesión"
      />
    </ChartCard>
  );
}

function StackedBarChart({
  labels,
  keys,
  keyLabels,
  keyColors,
  data,
  yTicks,
  yMax,
  ariaLabel,
  yFormatter,
}: {
  labels: string[];
  keys: string[];
  keyLabels: Record<string, string>;
  keyColors: Record<string, string>;
  data: Record<string, number>[];
  yTicks: number[];
  yMax: number;
  ariaLabel: string;
  yFormatter?: (v: number) => string;
}) {
  const W = 600;
  const H = 240;
  const padL = 36;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const slotW = innerW / n;
  const barW = Math.min(36, slotW * 0.6);

  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          className="h-auto w-full min-w-[320px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="#E8E1D2"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={yFor(t) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {yFormatter ? yFormatter(t) : t}
              </text>
            </g>
          ))}

          {data.map((row, i) => {
            const cx = padL + slotW * i + slotW / 2;
            let stackTop = yMax;
            return (
              <g key={i}>
                {keys.map((k) => {
                  const v = row[k] ?? 0;
                  if (v === 0) return null;
                  const yTopBar = yFor(stackTop);
                  const yBottomBar = yFor(stackTop - v);
                  stackTop -= v;
                  return (
                    <rect
                      key={k}
                      x={cx - barW / 2}
                      y={yTopBar}
                      width={barW}
                      height={Math.max(0, yBottomBar - yTopBar)}
                      fill={keyColors[k]}
                    />
                  );
                })}
              </g>
            );
          })}

          {labels.map((label, i) => {
            const cx = padL + slotW * i + slotW / 2;
            return (
              <text
                key={i}
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#627072"
                fontFamily="var(--font-sans)"
              >
                {label}
              </text>
            );
          })}
        </svg>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {keys.map((k) => (
          <li
            key={k}
            className="flex items-center gap-1.5 text-[11px] text-ink-500"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: keyColors[k] }}
            />
            {keyLabels[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================
// 5. Ratio de habla (StackedBarChart 100%)
// ============================================
/** Colapso de diarización: un solo hablante detectado. En payloads viejos sin
 *  `speakersDetectados`, un ratio 100/0 (o 0/100) se asume colapso — nunca se
 *  muestra como distribución real. */
function esColapsoDiarizacion(sa: SpeechAnalytics): boolean {
  if (typeof sa.speakersDetectados === "number") {
    return sa.speakersDetectados < 2;
  }
  const t = Math.round(sa.ratioHablaTerapeuta);
  const p = Math.round(sa.ratioHablaPaciente);
  return (t === 100 && p === 0) || (t === 0 && p === 100);
}

function RatioHablaChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const conSpeech = sesiones.filter((s) => s.speechAnalytics);
  if (conSpeech.length === 0) return null;

  let huboColapso = false;
  const data = sesiones.map((s) => {
    const sa = s.speechAnalytics;
    if (!sa) {
      return { terapeuta: 0, paciente: 0, vacio: 100 };
    }
    if (esColapsoDiarizacion(sa)) {
      huboColapso = true;
      return { terapeuta: 0, paciente: 0, vacio: 100 };
    }
    // Contrato (domain.ts): los ratios ya vienen en 0-100.
    const t = Math.round(sa.ratioHablaTerapeuta);
    const p = Math.round(sa.ratioHablaPaciente);
    return { terapeuta: t, paciente: p, vacio: 0 };
  });

  const labels = sessionLabels(sesiones);
  const lectura = lecturaRatioHabla();

  return (
    <ChartCard
      title="Ratio de habla"
      subtitle="Distribución del tiempo de habla entre terapeuta y paciente."
      lectura={lectura}
    >
      <StackedBarChart
        labels={labels}
        keys={["terapeuta", "paciente", "vacio"]}
        keyLabels={{
          terapeuta: "Terapeuta",
          paciente: "Paciente",
          vacio: "Sin datos",
        }}
        keyColors={{
          terapeuta: COLOR.gold,
          paciente: COLOR.sage,
          vacio: "#F4F0E8",
        }}
        data={data}
        yTicks={[0, 25, 50, 75, 100]}
        yMax={100}
        ariaLabel="Ratio de habla por sesión"
        yFormatter={(v) => `${v}%`}
      />
      {huboColapso ? (
        <p className="mt-2 text-[11px] text-ink-500">
          Sin datos: un solo hablante detectado en esa sesión.
        </p>
      ) : null}
    </ChartCard>
  );
}

// ============================================
// 6. Observación IA
// ============================================
function ObservacionIA({ sesiones }: { sesiones: SesionProgreso[] }) {
  const ultimaConObs = [...sesiones]
    .reverse()
    .find((s) => s.observacionIA && s.observacionIA.trim().length > 0);
  if (!ultimaConObs) return null;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] border-l-2 border-l-gold-500 bg-cream-50 p-4 lg:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Observación IA — Sesión {ultimaConObs.numero}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[16px] italic leading-[1.5] text-ink-900">
        «{ultimaConObs.observacionIA}»
      </p>
    </section>
  );
}

export function ProgresoClinicoSection({ pacienteId }: { pacienteId: string }) {
  return (
    <section className="mt-8 lg:mt-10">
      <h2 className="mb-3 flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        <EditorialRule />
        <span>Progreso clínico</span>
      </h2>
      <ProgresoClinico pacienteId={pacienteId} />
    </section>
  );
}
