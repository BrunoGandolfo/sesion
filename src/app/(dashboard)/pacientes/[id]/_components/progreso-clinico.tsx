"use client";

import * as React from "react";
import { Button, EditorialRule } from "@/components/ui";

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
};

type ProgresoResponse = {
  pacienteId: string;
  nombre: string;
  apellido: string;
  totalSesiones: number;
  sesiones: SesionProgreso[];
};

type LoadState = "loading" | "ready" | "error";

const MOCK_DATA: ProgresoResponse = {
  pacienteId: "mock",
  nombre: "Demo",
  apellido: "Mock",
  totalSesiones: 6,
  sesiones: [
    {
      fecha: "2026-03-04",
      numero: 1,
      intensidadEmocional: 8,
      alianzaTerapeutica: 2,
      alianzaLabel: "inestable",
      temas: ["ansiedad", "trabajo"],
      intervenciones: { reformulacion: 3, validacion: 2, senalamiento: 1 },
    },
    {
      fecha: "2026-03-11",
      numero: 2,
      intensidadEmocional: 7,
      alianzaTerapeutica: 3,
      alianzaLabel: "estable",
      temas: ["ansiedad", "pareja"],
      intervenciones: { reformulacion: 4, validacion: 3, senalamiento: 2 },
    },
    {
      fecha: "2026-03-18",
      numero: 3,
      intensidadEmocional: 6,
      alianzaTerapeutica: 3,
      alianzaLabel: "estable",
      temas: ["pareja", "familia"],
      intervenciones: { reformulacion: 2, validacion: 4, senalamiento: 3, otros: 1 },
      speechAnalytics: {
        ratioHablaTerapeuta: 0.42,
        ratioHablaPaciente: 0.58,
        cantidadSilencios: 6,
        duracionPromedioSilenciosSeg: 4,
        tiempoTotalHablaSeg: 2700,
      },
    },
    {
      fecha: "2026-03-25",
      numero: 4,
      intensidadEmocional: 5,
      alianzaTerapeutica: 2,
      alianzaLabel: "inestable",
      temas: ["familia", "trabajo"],
      intervenciones: { reformulacion: 3, validacion: 2, confrontacion: 2 },
      speechAnalytics: {
        ratioHablaTerapeuta: 0.48,
        ratioHablaPaciente: 0.52,
        cantidadSilencios: 4,
        duracionPromedioSilenciosSeg: 5,
        tiempoTotalHablaSeg: 2820,
      },
    },
    {
      fecha: "2026-04-01",
      numero: 5,
      intensidadEmocional: 4,
      alianzaTerapeutica: 3,
      alianzaLabel: "estable",
      temas: ["trabajo", "ansiedad"],
      intervenciones: { reformulacion: 2, validacion: 5, senalamiento: 2 },
      speechAnalytics: {
        ratioHablaTerapeuta: 0.38,
        ratioHablaPaciente: 0.62,
        cantidadSilencios: 8,
        duracionPromedioSilenciosSeg: 6,
        tiempoTotalHablaSeg: 2880,
      },
    },
    {
      fecha: "2026-04-08",
      numero: 6,
      intensidadEmocional: 3,
      alianzaTerapeutica: 4,
      alianzaLabel: "fuerte",
      temas: ["pareja", "logros"],
      intervenciones: { reformulacion: 1, validacion: 6, senalamiento: 1 },
      speechAnalytics: {
        ratioHablaTerapeuta: 0.35,
        ratioHablaPaciente: 0.65,
        cantidadSilencios: 9,
        duracionPromedioSilenciosSeg: 7,
        tiempoTotalHablaSeg: 2820,
      },
      observacionIA:
        "Hay un descenso sostenido de la intensidad emocional y la alianza pasó a fuerte. Los temas de logros emergen por primera vez.",
    },
  ],
};

async function fetchProgreso(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<ProgresoResponse> {
  const response = await fetch(`/api/pacientes/${pacienteId}/progreso`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo cargar el progreso.");
  const json = (await response.json()) as ProgresoResponse;
  return json;
}

export function ProgresoClinico({ pacienteId }: { pacienteId: string }) {
  const [data, setData] = React.useState<ProgresoResponse | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [usingMock, setUsingMock] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    setUsingMock(false);

    fetchProgreso(pacienteId, controller.signal)
      .then((next) => {
        setData(next);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(MOCK_DATA);
        setUsingMock(true);
        setLoadState("error");
      });

    return () => controller.abort();
  }, [pacienteId, reloadKey]);

  function retry() {
    setReloadKey((k) => k + 1);
  }

  if (loadState === "loading" && !data) {
    return <ProgresoSkeleton />;
  }

  if (!data) return null;

  if (data.totalSesiones < 3 && !usingMock) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {usingMock ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-ink-500">
            Mostrando datos de ejemplo. No pudimos conectar con el servidor.
          </p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Reintentar
          </Button>
        </div>
      ) : null}

      <FlagsRiesgoTimeline sesiones={data.sesiones} />
      <IntensidadChart sesiones={data.sesiones} />
      <AlianzaChart sesiones={data.sesiones} />
      <TemasTable sesiones={data.sesiones} />
      <IntervencionesChart sesiones={data.sesiones} />
      <RatioHablaChart sesiones={data.sesiones} />
      <ObservacionIA sesiones={data.sesiones} />
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

function EmptyState() {
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
        Todavía no hay suficiente recorrido.
      </p>
      <p className="mt-2 text-[13px] leading-[1.5] text-ink-500">
        Los gráficos de progreso aparecen a partir de la tercera sesión grabada.
      </p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
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
  const last = values.at(-1) ?? 0;
  const first = values[0] ?? 0;
  const delta = last - first;

  return (
    <ChartCard
      title="Intensidad emocional"
      subtitle="Cómo se siente al iniciar cada sesión (1 a 10). La baja sostenida indica mejora."
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
      <p className="mt-3 text-[11px] text-ink-500">
        {delta < 0
          ? `Bajó ${Math.abs(delta)} puntos desde la primera sesión.`
          : delta > 0
            ? `Subió ${delta} puntos desde la primera sesión.`
            : "Sin cambios respecto a la primera sesión."}
      </p>
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

  return (
    <ChartCard
      title="Alianza terapéutica"
      subtitle="Calidad del vínculo en cada sesión. Las caídas marcadas en terracotta son posibles rupturas."
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
  const counts = new Map<string, number>();
  sesiones.forEach((s) => {
    (s.temas ?? []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  });
  const temas = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  if (temas.length === 0) {
    return (
      <ChartCard
        title="Temas recurrentes"
        subtitle="Qué temas aparecen en cada sesión, ordenados por frecuencia."
      >
        <p className="py-6 text-center text-[13px] text-ink-500">
          Aún no hay temas registrados.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Temas recurrentes"
      subtitle="Qué temas aparecen en cada sesión, ordenados por frecuencia."
    >
      <div className="overflow-x-auto">
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
            {temas.map((tema) => (
              <tr
                key={tema}
                className="border-t border-[color:var(--border-subtle)]"
              >
                <td className="sticky left-0 z-[1] bg-white py-2 pr-3 text-ink-900 capitalize">
                  {tema}
                </td>
                {sesiones.map((s) => {
                  const present = s.temas.includes(tema);
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

  return (
    <ChartCard
      title="Intervenciones del terapeuta"
      subtitle="Cantidad y tipo de intervenciones por sesión."
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
function RatioHablaChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const conSpeech = sesiones.filter((s) => s.speechAnalytics);
  if (conSpeech.length === 0) return null;

  const data = sesiones.map((s) => {
    if (!s.speechAnalytics) {
      return { terapeuta: 0, paciente: 0, vacio: 100 };
    }
    const t = Math.round(s.speechAnalytics.ratioHablaTerapeuta * 100);
    const p = Math.round(s.speechAnalytics.ratioHablaPaciente * 100);
    return { terapeuta: t, paciente: p, vacio: 0 };
  });

  const labels = sessionLabels(sesiones);

  return (
    <ChartCard
      title="Ratio de habla"
      subtitle="Distribución del tiempo de habla entre terapeuta y paciente."
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
