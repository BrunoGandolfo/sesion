// Lectura tolerante del análisis de "Para vos": el `feedbackTerapeuta` crudo
// de una sesión, validado pieza por pieza. Sin React; lo dibuja
// FeedbackTerapeutaView.tsx.

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
