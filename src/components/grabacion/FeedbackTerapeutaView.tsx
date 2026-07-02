"use client";

import { CheckCircle2, Lightbulb, Sparkles } from "lucide-react";

import type {
  AreaCrecimientoFeedback,
  EvidenciaFeedback,
  FeedbackGestalt,
  FeedbackMitiCtsr,
  FeedbackNucleoPanteorico,
  FeedbackTerapeuta,
  FeedbackTerapeutaLegacy,
  FortalezaFeedback,
  ItemGTFS,
  ScoreCTSR,
  ScoreMITIGlobal,
} from "@/types/domain";
import { normalizarFeedback } from "@/types/domain";

interface FeedbackTerapeutaViewProps {
  feedbackTerapeuta:
    | FeedbackTerapeuta
    | FeedbackTerapeutaLegacy
    | null
    | undefined;
}

type Tono = "sage" | "gold" | "terracotta" | "neutral";

const TONO_BAR_BG: Record<Tono, string> = {
  sage: "bg-sage-500",
  gold: "bg-gold-500",
  terracotta: "bg-terracotta-500",
  neutral: "bg-ink-300",
};

const TONO_VALUE_TEXT: Record<Tono, string> = {
  sage: "text-sage-700",
  gold: "text-gold-500",
  terracotta: "text-terracotta-600",
  neutral: "text-ink-500",
};

function tonoMITI(score: number | null): Tono {
  if (score === null) return "neutral";
  if (score >= 3) return "sage";
  if (score === 2) return "gold";
  return "terracotta";
}

function tonoCTSR(score: number | null): Tono {
  if (score === null) return "neutral";
  if (score >= 3) return "sage";
  if (score >= 1) return "gold";
  return "terracotta";
}

interface ScoreBarProps {
  label: string;
  score: number | null;
  maxScore: number;
  tono: Tono;
  razon?: string;
  evidence: EvidenciaFeedback[];
}

function ScoreBar({ label, score, maxScore, tono, razon, evidence }: ScoreBarProps) {
  const porcentaje =
    score === null ? 0 : Math.min(100, Math.max(0, (score / maxScore) * 100));
  const valueId = `${label.replace(/\s+/g, "-").toLowerCase()}-value`;

  return (
    <div className="flex min-h-[44px] flex-col gap-2 py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span
          id={valueId}
          className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-700"
        >
          {label}
        </span>
        <span
          className={`font-display text-[14px] font-medium ${TONO_VALUE_TEXT[tono]}`}
        >
          {score === null ? (
            "No determinable"
          ) : (
            <>
              {score}
              <span className="text-ink-500"> / {maxScore}</span>
            </>
          )}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={maxScore}
        aria-valuenow={score ?? 0}
        aria-labelledby={valueId}
        className="h-2 w-full overflow-hidden rounded-full bg-cream-100"
      >
        {score !== null && (
          <div
            className={`h-full rounded-full transition-all duration-200 ${TONO_BAR_BG[tono]}`}
            style={{ width: `${porcentaje}%` }}
          />
        )}
      </div>

      {score === null && razon && (
        <p className="font-sans text-[12px] italic text-ink-500">
          {razon}
        </p>
      )}

      {evidence.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-1">
          {evidence.map((ev, index) => (
            <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceItem({ evidencia }: { evidencia: EvidenciaFeedback }) {
  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-cream-200 pl-3">
      {evidencia.timestamp && (
        <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-500">
          {evidencia.timestamp}
        </span>
      )}
      <span className="font-sans text-[13px] italic leading-[1.5] text-ink-700">
        “{evidencia.quote}”
      </span>
    </li>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-[16px] font-medium text-ink-900">
      {children}
    </h3>
  );
}

function FortalezaItem({ fortaleza }: { fortaleza: FortalezaFeedback }) {
  return (
    <li className="flex min-h-[44px] gap-3 py-1">
      <CheckCircle2
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-sage-500"
      />
      <div className="flex flex-col gap-1.5">
        <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
          {fortaleza.descripcion}
        </p>
        {fortaleza.evidence.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {fortaleza.evidence.map((ev, index) => (
              <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function AreaCrecimientoItem({ area }: { area: AreaCrecimientoFeedback }) {
  return (
    <li className="flex min-h-[44px] gap-3 py-1">
      <Lightbulb
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-gold-500"
      />
      <div className="flex flex-col gap-1.5">
        <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
          {area.observacion}
        </p>
        <p className="font-sans text-[13px] leading-[1.55] text-ink-700">
          <span className="font-semibold uppercase tracking-[0.08em] text-[11px] text-ink-500">
            Sugerencia ·{" "}
          </span>
          {area.sugerencia}
        </p>
        {area.evidence.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {area.evidence.map((ev, index) => (
              <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const DISCLAIMER_TEXT =
  "Este análisis es generado por IA a partir de la transcripción. No sustituye la supervisión clínica profesional. Las métricas son orientativas y deben interpretarse en contexto.";

export function FeedbackTerapeutaView({
  feedbackTerapeuta,
}: FeedbackTerapeutaViewProps) {
  if (!feedbackTerapeuta) return null;

  // Punto de entrada de datos: las sesiones persistidas antes del contrato
  // multi-orientación no traen discriminador `instrumento` — se normalizan
  // al leer (nunca se migran).
  const feedback = normalizarFeedback(feedbackTerapeuta);

  return (
    <section
      aria-label="Auto-supervisión de la sesión"
      className="flex flex-col gap-6 rounded-lg border border-[color:var(--border-subtle)] bg-white p-5 shadow-subtle sm:p-6"
    >
      <header className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="h-5 w-5 text-sage-500" />
        <h2 className="font-display text-[18px] font-medium text-ink-900">
          Auto-supervisión de la sesión
        </h2>
      </header>

      {feedback.instrumento === "cbt_mi" ? (
        <BloqueMitiCtsr feedback={feedback} />
      ) : (
        <BloqueGestalt feedback={feedback} />
      )}

      <NucleoPanteoricoSections nucleo={feedback} />

      <p className="border-t border-cream-200 pt-4 font-sans text-[12px] leading-[1.55] italic text-ink-500">
        {DISCLAIMER_TEXT}
      </p>
    </section>
  );
}

// ─── Núcleo panteórico (compartido por todo instrumento) ─────────────

function NucleoPanteoricoSections({
  nucleo,
}: {
  nucleo: FeedbackNucleoPanteorico;
}) {
  const fortalezasVisibles = nucleo.fortalezas.slice(0, 3);
  const areasVisibles = nucleo.areasCrecimiento.slice(0, 3);

  return (
    <>
      {fortalezasVisibles.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle>Fortalezas observadas</SectionTitle>
          <ul className="flex flex-col gap-3">
            {fortalezasVisibles.map((fortaleza, index) => (
              <FortalezaItem
                key={`${fortaleza.descripcion}-${index}`}
                fortaleza={fortaleza}
              />
            ))}
          </ul>
        </div>
      )}

      {areasVisibles.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle>Áreas de crecimiento</SectionTitle>
          <ul className="flex flex-col gap-3">
            {areasVisibles.map((area, index) => (
              <AreaCrecimientoItem
                key={`${area.observacion}-${index}`}
                area={area}
              />
            ))}
          </ul>
        </div>
      )}

      {nucleo.sugerenciaProximaSesion.trim() && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Observación general</SectionTitle>
          <p className="font-sans text-[14px] leading-[1.65] text-ink-900">
            {nucleo.sugerenciaProximaSesion}
          </p>
        </div>
      )}
    </>
  );
}

// ─── Bloque MITI 4.2.1 + CTS-R (instrumento cbt_mi) ──────────────────

function BloqueMitiCtsr({ feedback }: { feedback: FeedbackMitiCtsr }) {
  const { mitiGlobales, ctsrSubset } = feedback;

  const empathy: ScoreMITIGlobal = mitiGlobales.empathy;
  const partnership: ScoreMITIGlobal = mitiGlobales.partnership;

  const ctsrItems: Array<{ key: string; label: string; score: ScoreCTSR }> = [
    { key: "agendaSetting", label: "Establecimiento de agenda", score: ctsrSubset.agendaSetting },
    { key: "feedback", label: "Feedback del paciente", score: ctsrSubset.feedback },
    { key: "collaboration", label: "Colaboración", score: ctsrSubset.collaboration },
    { key: "guidedDiscovery", label: "Descubrimiento guiado", score: ctsrSubset.guidedDiscovery },
  ];

  return (
    <>
      <div className="flex flex-col gap-3">
        <SectionTitle>MITI 4.2.1 · Globales</SectionTitle>
        <div className="flex flex-col gap-4">
          <ScoreBar
            label="Empatía"
            score={empathy.score}
            maxScore={5}
            tono={tonoMITI(empathy.score)}
            razon={empathy.razon}
            evidence={empathy.evidence}
          />
          <ScoreBar
            label="Colaboración"
            score={partnership.score}
            maxScore={5}
            tono={tonoMITI(partnership.score)}
            razon={partnership.razon}
            evidence={partnership.evidence}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>CTS-R · Subset</SectionTitle>
        <div className="flex flex-col gap-4">
          {ctsrItems.map((item) => (
            <ScoreBar
              key={item.key}
              label={item.label}
              score={item.score.score}
              maxScore={6}
              tono={tonoCTSR(item.score.score)}
              razon={item.score.razon}
              evidence={item.score.evidence}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Bloque GTFS (instrumento gestalt) ───────────────────────────────

/** Dimensiones de la GTFS (Fogarty et al. 2019). La pertenencia de un
 *  ítem se deriva del número en su id ("gtfs_NN"). */
const DIMENSIONES_GTFS: Array<{ titulo: string; desde: number; hasta: number }> = [
  { titulo: "Relación dialogal", desde: 1, hasta: 4 },
  { titulo: "Aquí y ahora", desde: 5, hasta: 6 },
  { titulo: "Práctica fenomenológica", desde: 7, hasta: 9 },
  { titulo: "Conciencia corporal", desde: 10, hasta: 12 },
  { titulo: "Sensible al campo", desde: 13, hasta: 14 },
  { titulo: "Procesos de contacto", desde: 15, hasta: 17 },
  { titulo: "Actitud experimental", desde: 18, hasta: 20 },
];

function numeroDeItemGTFS(id: string): number | null {
  const match = /^gtfs_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function BloqueGestalt({ feedback }: { feedback: FeedbackGestalt }) {
  const items = feedback.itemsGTFS;
  const evaluables = items.filter((item) => item.score !== null);
  const presentes = evaluables.filter((item) => (item.score ?? 0) > 0);

  const dimensiones = DIMENSIONES_GTFS.map((dimension) => ({
    titulo: dimension.titulo,
    items: items.filter((item) => {
      const numero = numeroDeItemGTFS(item.id);
      return numero !== null && numero >= dimension.desde && numero <= dimension.hasta;
    }),
  })).filter((dimension) => dimension.items.length > 0);

  const sinDimension = items.filter((item) => {
    const numero = numeroDeItemGTFS(item.id);
    return numero === null || numero < 1 || numero > 20;
  });

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg bg-cream-100 p-4 sm:p-5">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Adherencia global · GTFS
        </span>
        {evaluables.length === 0 ? (
          <p className="font-sans text-[14px] leading-[1.6] text-ink-700">
            Ningún ítem fue evaluable a partir de la transcripción de esta
            sesión.
          </p>
        ) : (
          <p className="flex items-baseline gap-2">
            <span className="font-display text-[34px] font-medium leading-none text-ink-900">
              {presentes.length}
            </span>
            <span className="font-sans text-[14px] text-ink-700">
              de {evaluables.length} ítems evaluables presentes
            </span>
          </p>
        )}
        <p className="font-sans text-[12px] leading-[1.55] text-ink-500">
          La GTFS releva la presencia de prácticas gestálticas en la sesión.
          Es una referencia para tu auto-supervisión, no una calificación.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <SectionTitle>GTFS · Ítems por dimensión</SectionTitle>
        {dimensiones.map((dimension) => (
          <div key={dimension.titulo} className="flex flex-col gap-3">
            <h4 className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {dimension.titulo}
            </h4>
            <ul className="flex flex-col gap-3">
              {dimension.items.map((item) => (
                <ItemGTFSRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
        {sinDimension.length > 0 && (
          <div className="flex flex-col gap-3">
            <h4 className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Otros ítems
            </h4>
            <ul className="flex flex-col gap-3">
              {sinDimension.map((item) => (
                <ItemGTFSRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

type EstadoItemGTFS = "presente" | "ausente" | "no_determinable";

function estadoDeItemGTFS(item: ItemGTFS): EstadoItemGTFS {
  if (item.score === null) return "no_determinable";
  return item.score > 0 ? "presente" : "ausente";
}

const ESTADO_GTFS_LABEL: Record<EstadoItemGTFS, string> = {
  presente: "Presente",
  ausente: "Ausente",
  no_determinable: "No determinable",
};

const ESTADO_GTFS_TEXT: Record<EstadoItemGTFS, string> = {
  presente: "text-sage-700",
  ausente: "text-ink-500",
  no_determinable: "text-ink-500",
};

const ESTADO_GTFS_DOT: Record<EstadoItemGTFS, string> = {
  presente: "bg-sage-500",
  ausente: "bg-ink-300",
  no_determinable: "border border-dashed border-ink-300 bg-transparent",
};

function ItemGTFSRow({ item }: { item: ItemGTFS }) {
  const estado = estadoDeItemGTFS(item);

  return (
    <li className="flex min-h-[44px] gap-3 py-1">
      <span
        aria-hidden="true"
        className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${ESTADO_GTFS_DOT[estado]}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-sans text-[14px] leading-[1.5] text-ink-900">
            {item.nombre}
          </span>
          <span
            className={`shrink-0 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] ${ESTADO_GTFS_TEXT[estado]}`}
          >
            {ESTADO_GTFS_LABEL[estado]}
          </span>
        </div>

        {estado === "no_determinable" && item.razon && (
          <p className="font-sans text-[12px] italic text-ink-500">
            {item.razon}
          </p>
        )}

        {item.evidence.length > 0 && (
          <details>
            <summary className="cursor-pointer list-none font-sans text-[12px] font-semibold text-ink-500 transition-colors duration-150 hover:text-ink-700 [&::-webkit-details-marker]:hidden">
              {item.evidence.length === 1
                ? "Ver 1 evidencia"
                : `Ver ${item.evidence.length} evidencias`}
            </summary>
            <ul className="flex flex-col gap-1.5 pt-1.5">
              {item.evidence.map((ev, index) => (
                <EvidenceItem key={`${ev.timestamp}-${index}`} evidencia={ev} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}
