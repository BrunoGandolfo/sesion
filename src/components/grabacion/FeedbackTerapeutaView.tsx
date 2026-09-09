"use client";

import { AlertCircle, CheckCircle2, Lightbulb } from "lucide-react";

import { Plegable } from "@/components/ui";
import {
  CTSR,
  GTFS,
  MITI,
  PARA_VOS_INCOMPLETO,
  VER_DETALLE,
  pluralizar,
} from "@/lib/glosario";
import type {
  AreaCrecimientoFeedback,
  CTSRSubset,
  EvidenciaFeedback,
  FortalezaFeedback,
  ItemGTFS,
  MITIGlobales,
  OrientacionTeorica,
  ScoreCTSR,
  ScoreMITIGlobal,
} from "@/types/domain";

// "Para vos": la auto-supervisión de una sesión, entera y sin plegar.
//
// Ya no es un bloque al pie de la nota. Vive en su propia vista
// (/sesiones/[id]/para-vos) y este componente dibuja su contenido: el
// instrumento, las fortalezas, las áreas de crecimiento y el disclaimer.
//
// EL GUARDIÁN, QUE ANTES ESCONDÍA
//
// La nota tenía un `esFeedbackRenderizable` que pedía dos arrays y, si
// faltaba alguno, no dibujaba NADA — sin decirlo. El feedback existía, ella
// no se enteraba. Acá el criterio es el opuesto: se lee lo que se pueda, se
// muestra lo que llegó, y si algo faltó se avisa con una línea chica.
// Lo único que devuelve null es un payload que no es un objeto: eso no es
// feedback incompleto, es feedback ausente.
//
// Nada se inventa para tapar el hueco: un bloque de instrumento que no llegó
// entero no se dibuja con ceros ni con "No determinable" —eso sería ponerle
// al modelo palabras que no dijo—, simplemente no se dibuja y el aviso lo
// cuenta.

// ─── Lectura tolerante del payload ───────────────────────────────────
// `feedbackTerapeuta` viaja como `unknown` en el contrato
// (src/lib/sesion-clinica/schema.ts:139): la forma se valida al leer. Estos
// guards son esa validación, pieza por pieza, para que la falta de una no
// se lleve puestas a las otras.

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string";
}

function esEvidencia(valor: unknown): valor is EvidenciaFeedback {
  return esObjeto(valor) && esTexto(valor.quote) && esTexto(valor.timestamp);
}

/** Las citas son lo que sostiene cada afirmación: las que no tienen la forma
 *  del contrato se descartan de a una, nunca se inventan. */
function leerEvidencias(valor: unknown): EvidenciaFeedback[] {
  return Array.isArray(valor) ? valor.filter(esEvidencia) : [];
}

function leerFortalezas(valor: unknown): FortalezaFeedback[] | null {
  if (!Array.isArray(valor)) return null;
  return valor.filter(esObjeto).flatMap((item) =>
    esTexto(item.descripcion)
      ? [{ descripcion: item.descripcion, evidence: leerEvidencias(item.evidence) }]
      : [],
  );
}

function leerAreas(valor: unknown): AreaCrecimientoFeedback[] | null {
  if (!Array.isArray(valor)) return null;
  return valor.filter(esObjeto).flatMap((item) =>
    esTexto(item.observacion) && esTexto(item.sugerencia)
      ? [
          {
            observacion: item.observacion,
            sugerencia: item.sugerencia,
            evidence: leerEvidencias(item.evidence),
          },
        ]
      : [],
  );
}

/** Un score es un número o un null explícito ("no determinable"). Cualquier
 *  otra cosa —undefined, un string— no es un score y devuelve null acá, que
 *  invalida el bloque entero de ese instrumento. */
function leerScore(valor: unknown): ScoreMITIGlobal | null {
  if (!esObjeto(valor)) return null;
  const score = valor.score;
  if (score !== null && typeof score !== "number") return null;
  return {
    score,
    evidence: leerEvidencias(valor.evidence),
    ...(esTexto(valor.razon) ? { razon: valor.razon } : {}),
  };
}

const CLAVES_CTSR = [
  "agendaSetting",
  "feedback",
  "collaboration",
  "guidedDiscovery",
] as const;

function leerMitiGlobales(valor: unknown): MITIGlobales | null {
  if (!esObjeto(valor)) return null;
  // La vista lee empatía y colaboración; las otras dos globales viajan pero
  // no se dibujan, así que no condicionan si el bloque se puede mostrar.
  const empathy = leerScore(valor.empathy);
  const partnership = leerScore(valor.partnership);
  if (!empathy || !partnership) return null;
  const resto = leerScore(valor.cultivatingChangeTalk) ?? empathy;
  return {
    empathy,
    partnership,
    cultivatingChangeTalk: resto,
    softeningSustainTalk: leerScore(valor.softeningSustainTalk) ?? resto,
  };
}

function leerCtsrSubset(valor: unknown): CTSRSubset | null {
  if (!esObjeto(valor)) return null;
  const items = CLAVES_CTSR.map((clave) => leerScore(valor[clave]));
  if (items.some((item) => item === null)) return null;
  const [agendaSetting, feedback, collaboration, guidedDiscovery] =
    items as ScoreCTSR[];
  return { agendaSetting, feedback, collaboration, guidedDiscovery };
}

function leerItemsGTFS(valor: unknown): ItemGTFS[] | null {
  if (!Array.isArray(valor)) return null;
  return valor.filter(esObjeto).flatMap((item) => {
    const score = item.score;
    if (!esTexto(item.id) || !esTexto(item.nombre)) return [];
    if (score !== null && typeof score !== "number") return [];
    return [
      {
        id: item.id,
        nombre: item.nombre,
        score,
        ...(esTexto(item.razon) ? { razon: item.razon } : {}),
        evidence: leerEvidencias(item.evidence),
      },
    ];
  });
}

/** Lo que se pudo leer del análisis, con la marca de si llegó entero. */
export interface FeedbackLegible {
  instrumento: OrientacionTeorica;
  fortalezas: FortalezaFeedback[];
  areasCrecimiento: AreaCrecimientoFeedback[];
  sugerenciaProximaSesion: string;
  /** Bloque MITI/CTS-R, solo si llegó completo. */
  mitiGlobales: MITIGlobales | null;
  ctsrSubset: CTSRSubset | null;
  /** Bloque GTFS, solo si llegó completo. */
  itemsGTFS: ItemGTFS[] | null;
  /** false si alguna parte del payload faltaba o no tenía la forma del
   *  contrato. Es lo que enciende el aviso. */
  completo: boolean;
}

/**
 * Lee el `feedbackTerapeuta` de una sesión. Devuelve null solo cuando no hay
 * análisis; cualquier objeto, por incompleto que esté, devuelve algo que se
 * puede mostrar.
 *
 * Un feedback sin discriminador `instrumento` es de antes del contrato
 * multi-orientación y siempre fue MITI/CTS-R: la misma regla que
 * normalizarFeedback (src/lib/sesion-clinica/normalizar.ts), aplicada acá
 * sobre `unknown` en vez de sobre la unión ya tipada.
 */
export function leerFeedback(valor: unknown): FeedbackLegible | null {
  if (!esObjeto(valor)) return null;

  const instrumento: OrientacionTeorica =
    valor.instrumento === "gestalt" ? "gestalt" : "cbt_mi";

  const fortalezas = leerFortalezas(valor.fortalezas);
  const areasCrecimiento = leerAreas(valor.areasCrecimiento);
  const sugerencia = valor.sugerenciaProximaSesion;

  const itemsGTFS = instrumento === "gestalt" ? leerItemsGTFS(valor.itemsGTFS) : null;
  const mitiGlobales =
    instrumento === "cbt_mi" ? leerMitiGlobales(valor.mitiGlobales) : null;
  const ctsrSubset =
    instrumento === "cbt_mi" ? leerCtsrSubset(valor.ctsrSubset) : null;

  const bloqueDelInstrumento =
    instrumento === "gestalt"
      ? itemsGTFS !== null
      : mitiGlobales !== null && ctsrSubset !== null;

  return {
    instrumento,
    fortalezas: fortalezas ?? [],
    areasCrecimiento: areasCrecimiento ?? [],
    sugerenciaProximaSesion: esTexto(sugerencia) ? sugerencia : "",
    mitiGlobales,
    ctsrSubset,
    itemsGTFS,
    completo:
      fortalezas !== null &&
      areasCrecimiento !== null &&
      esTexto(sugerencia) &&
      bloqueDelInstrumento,
  };
}

/** True si hay algo que dibujar además del disclaimer. */
function tieneContenido(feedback: FeedbackLegible): boolean {
  return (
    feedback.fortalezas.length > 0 ||
    feedback.areasCrecimiento.length > 0 ||
    feedback.sugerenciaProximaSesion.trim() !== "" ||
    feedback.itemsGTFS !== null ||
    feedback.mitiGlobales !== null
  );
}

/**
 * True si "Para vos" tiene algo que decir sobre esta sesión.
 *
 * Es exactamente el criterio con el que FeedbackTerapeutaView decide si
 * dibuja o devuelve null, expuesto para que quien ofrece el camino —el
 * selector de la sesión, el aviso de después de aprobar, la fila de la
 * ficha— no ofrezca una pantalla vacía. Un análisis incompleto SÍ cuenta:
 * ahí hay algo que mostrar y un aviso que dar.
 */
export function hayParaVos(valor: unknown): boolean {
  const feedback = leerFeedback(valor);
  if (!feedback) return false;
  return !feedback.completo || tieneContenido(feedback);
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

/** Cita literal con timestamp. Exportado para reutilizar el patrón fuera
 *  del feedback (ej. RiesgoDetectadoBanner): EvidenciaRiesgo comparte el
 *  shape { timestamp, quote } y es asignable estructuralmente. */
export function EvidenceItem({ evidencia }: { evidencia: EvidenciaFeedback }) {
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

/** Cabecera de un instrumento de auto-supervisión: sigla, nombre completo y
 *  la línea de ayuda del glosario. La sigla NUNCA se reemplaza — es lo que
 *  le permite a la profesional rastrear qué se le está midiendo. */
function TituloInstrumento({
  instrumento,
}: {
  instrumento: { sigla: string; nombre: string; ayuda: string };
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionTitle>{instrumento.sigla}</SectionTitle>
      <p className="font-sans text-[13px] leading-[1.5] text-ink-500">
        {instrumento.nombre} — {instrumento.ayuda}
      </p>
    </div>
  );
}

/** "Ver detalle · N ítems": los ítems del instrumento, plegados. Los nombres
 *  de dimensiones e ítems no se tocan. */
function DetalleDeItems({
  cantidad,
  children,
}: {
  cantidad: number;
  children: React.ReactNode;
}) {
  return (
    <Plegable titulo={`${VER_DETALLE} · ${pluralizar(cantidad, "ítem", "ítems")}`}>
      {children}
    </Plegable>
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

interface FeedbackTerapeutaViewProps {
  /** El payload crudo de `datosEstructurados.feedbackTerapeuta`. Va como
   *  `unknown` porque así viaja en el contrato: la forma se valida acá. */
  feedbackTerapeuta: unknown;
}

export function FeedbackTerapeutaView({
  feedbackTerapeuta,
}: FeedbackTerapeutaViewProps) {
  const feedback = leerFeedback(feedbackTerapeuta);
  // Un análisis con la forma correcta y sin una sola línea adentro no es
  // nada que leer: eso sí se calla. Lo que nunca se calla es un análisis
  // incompleto, que es el caso que este componente vino a arreglar.
  if (!feedback || !hayParaVos(feedbackTerapeuta)) return null;

  return (
    <div className="flex flex-col gap-5">
      {feedback.completo ? null : <AvisoIncompleto />}

      {feedback.mitiGlobales && feedback.ctsrSubset ? (
        <BloqueMitiCtsr
          mitiGlobales={feedback.mitiGlobales}
          ctsrSubset={feedback.ctsrSubset}
        />
      ) : null}

      {feedback.itemsGTFS ? <BloqueGestalt items={feedback.itemsGTFS} /> : null}

      <NucleoPanteoricoSections nucleo={feedback} />

      <p className="border-t border-cream-200 pt-4 font-sans text-[12px] leading-[1.55] italic text-ink-500">
        {DISCLAIMER_TEXT}
      </p>
    </div>
  );
}

/** El hueco, dicho en una línea. Terracotta como cualquier aviso de la app,
 *  y sin botón: no hay nada que ella pueda reintentar desde acá. */
function AvisoIncompleto() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md bg-terracotta-50 px-3.5 py-2.5 font-sans text-[13px] leading-[1.5] text-terracotta-600"
    >
      <AlertCircle
        size={16}
        strokeWidth={1.9}
        aria-hidden="true"
        className="mt-[2px] shrink-0"
      />
      {PARA_VOS_INCOMPLETO}
    </p>
  );
}

// ─── Núcleo panteórico (compartido por todo instrumento) ─────────────

function NucleoPanteoricoSections({ nucleo }: { nucleo: FeedbackLegible }) {
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

function BloqueMitiCtsr({
  mitiGlobales,
  ctsrSubset,
}: {
  mitiGlobales: MITIGlobales;
  ctsrSubset: CTSRSubset;
}) {
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
        <TituloInstrumento instrumento={MITI} />
        <DetalleDeItems cantidad={2}>
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
        </DetalleDeItems>
      </div>

      <div className="flex flex-col gap-3">
        <TituloInstrumento instrumento={CTSR} />
        <DetalleDeItems cantidad={ctsrItems.length}>
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
        </DetalleDeItems>
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

function BloqueGestalt({ items }: { items: ItemGTFS[] }) {
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
      <TituloInstrumento instrumento={GTFS} />

      <div className="flex flex-col gap-2 rounded-lg bg-cream-100 p-4 sm:p-5">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Adherencia global · {GTFS.sigla}
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

      <DetalleDeItems cantidad={items.length}>
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
      </DetalleDeItems>
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
