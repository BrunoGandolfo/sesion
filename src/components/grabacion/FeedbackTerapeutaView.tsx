"use client";

import { CheckCircle2, Lightbulb, Sparkles } from "lucide-react";

import type {
  AreaCrecimientoFeedback,
  EvidenciaFeedback,
  FeedbackTerapeuta,
  FeedbackTerapeutaLegacy,
  FortalezaFeedback,
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
        <span className="font-sans text-[11px] font-semibold text-ink-500">
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

  // El render específico por instrumento (GTFS) llega en Wave 2.
  // Por ahora este componente solo sabe renderizar MITI/CTS-R.
  if (feedback.instrumento !== "cbt_mi") return null;

  const {
    mitiGlobales,
    ctsrSubset,
    fortalezas,
    areasCrecimiento,
    sugerenciaProximaSesion,
  } = feedback;

  const empathy: ScoreMITIGlobal = mitiGlobales.empathy;
  const partnership: ScoreMITIGlobal = mitiGlobales.partnership;

  const ctsrItems: Array<{ key: string; label: string; score: ScoreCTSR }> = [
    { key: "agendaSetting", label: "Establecimiento de agenda", score: ctsrSubset.agendaSetting },
    { key: "feedback", label: "Feedback del paciente", score: ctsrSubset.feedback },
    { key: "collaboration", label: "Colaboración", score: ctsrSubset.collaboration },
    { key: "guidedDiscovery", label: "Descubrimiento guiado", score: ctsrSubset.guidedDiscovery },
  ];

  const fortalezasVisibles = fortalezas.slice(0, 3);
  const areasVisibles = areasCrecimiento.slice(0, 3);

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

      {sugerenciaProximaSesion.trim() && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Observación general</SectionTitle>
          <p className="font-sans text-[14px] leading-[1.65] text-ink-900">
            {sugerenciaProximaSesion}
          </p>
        </div>
      )}

      <p className="border-t border-cream-200 pt-4 font-sans text-[12px] leading-[1.55] italic text-ink-500">
        {DISCLAIMER_TEXT}
      </p>
    </section>
  );
}
