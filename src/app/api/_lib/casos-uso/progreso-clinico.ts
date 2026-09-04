// Caso de uso: el recorrido clínico de una paciente, leído de corrido.
//
// Tres miradas sobre las mismas sesiones, cada una con su alcance:
//
//   sesiones → solo las del rango elegido, en orden cronológico. Es la
//     serie que se grafica: intensidad emocional, alianza terapéutica,
//     nivel de riesgo, intervenciones de cada encuentro.
//
//   temas → sobre TODAS las sesiones, no sobre el rango. Un tema que
//     aparece hace dos años y vuelve ahora es material recurrente aunque el
//     gráfico muestre los últimos tres meses; recortarlo al rango haría que
//     "primera vez" mintiera.
//
//   riesgos → todas, cronológico. Una señal de riesgo no envejece: se
//     muestran completas o no se muestran.
//
// El `numero` de sesión es global (1 = la primera de la historia), no
// relativo al rango: "la sesión 12" tiene que significar lo mismo en las
// cuatro vistas.
//
// Módulo puro: recibe las filas ya leídas y devuelve el payload. No toca la
// base ni conoce Request/Response, así que se testea sin DB.

import {
  flagRiesgoSchema,
  type DatosEstructurados,
} from "@/lib/sesion-clinica/schema";

// ────────────────────────────────────────────────────────────────────────────
// Rango
// ────────────────────────────────────────────────────────────────────────────

/** Los cuatro alcances del gráfico. "10s" = las últimas 10 sesiones. */
export const RANGOS_PROGRESO = ["10s", "3m", "6m", "todo"] as const;
export type RangoProgreso = (typeof RANGOS_PROGRESO)[number];

/** Lo que se muestra si nadie pidió otra cosa: las últimas 10 sesiones. */
export const RANGO_PROGRESO_DEFAULT: RangoProgreso = "10s";

/** Cuántas sesiones entran en el rango "10s". */
const ULTIMAS_SESIONES = 10;

/** Contra cuántas sesiones recientes se mide la tendencia de un tema. */
const VENTANA_TENDENCIA = 5;

/**
 * Banda muerta de la tendencia: una diferencia menor al 20% entre la
 * frecuencia reciente y la anterior es "estable". Sin banda, cualquier
 * variación mínima marcaría el tema como que sube o baja.
 */
const UMBRAL_TENDENCIA = 0.2;

export function esRangoProgreso(valor: unknown): valor is RangoProgreso {
  return (
    typeof valor === "string" &&
    (RANGOS_PROGRESO as readonly string[]).includes(valor)
  );
}

/** El query param → un rango válido; cualquier otra cosa cae en el default. */
export function parseRangoProgreso(valor: unknown): RangoProgreso {
  return esRangoProgreso(valor) ? valor : RANGO_PROGRESO_DEFAULT;
}

// ────────────────────────────────────────────────────────────────────────────
// Formas
// ────────────────────────────────────────────────────────────────────────────

/** Una sesión tal como la lee la ruta: fecha del turno + datos ya parseados. */
export interface SesionCruda {
  sesionId: string;
  fecha: Date;
  datos: DatosEstructurados | null;
}

export interface SesionProgreso {
  sesionId: string;
  /** Fecha del turno, ISO. */
  fecha: string;
  /** Número de sesión en toda la historia de la paciente, desde 1. */
  numero: number;
  /** Escala 1-10 del tablero. null si el análisis no la trajo. */
  intensidadEmocional: number | null;
  /** "fragil" | "inestable" | "estable" | "fuerte", o null. */
  alianzaTerapeutica: string | null;
  temas: string[];
  /** "ninguno" | "bajo" | "moderado" | "alto", o null si no se graduó. */
  nivelRiesgo: string | null;
  /** El objeto de flags booleanos tal como lo dejó el análisis, o null. */
  flagsRiesgo: DatosEstructurados["flagsRiesgo"] | null;
  /** Cuántas intervenciones de cada tipo: { reformulacion: 3, ... }. */
  intervenciones: Record<string, number>;
  observacionIA: string | null;
  progresoPercibido: string | null;
}

/** Cómo se movió un tema entre las últimas sesiones y las anteriores. */
export type TendenciaTema = "nuevo" | "sube" | "baja" | "estable";

export interface TemaProgreso {
  tema: string;
  /** En cuántas sesiones apareció (una vez por sesión, aunque se repita). */
  conteo: number;
  /** Sobre cuántas sesiones se contó: el total de la paciente. */
  deTotal: number;
  primeraVez: string;
  ultimaVez: string;
  tendencia: TendenciaTema;
}

export interface RiesgoProgreso {
  sesionId: string;
  fecha: string;
  /** Nombre del flag: "ideacionSuicida", "autolesion", … */
  flag: string;
  nivel: string | null;
  /** Cita literal que sostiene la señal, si el análisis la trajo. */
  cita: string | null;
}

export interface ProgresoClinico {
  pacienteId: string;
  /** Todas las sesiones con nota, sin importar el rango. */
  totalSesiones: number;
  rango: RangoProgreso;
  sesiones: SesionProgreso[];
  temas: TemaProgreso[];
  riesgos: RiesgoProgreso[];
}

/** Cuántos temas se devuelven, los más frecuentes primero. */
const TOPE_TEMAS = 15;

// ────────────────────────────────────────────────────────────────────────────
// Armado
// ────────────────────────────────────────────────────────────────────────────

function contarIntervenciones(
  intervenciones: DatosEstructurados["intervenciones"],
): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const intervencion of intervenciones ?? []) {
    cuenta[intervencion.tipo] = (cuenta[intervencion.tipo] ?? 0) + 1;
  }
  return cuenta;
}

/**
 * Las sesiones que entran en el rango. "10s" corta por cantidad; "3m" y "6m"
 * por fecha, contando meses de calendario hacia atrás desde `ahora`.
 */
function recortarPorRango(
  sesiones: SesionCruda[],
  rango: RangoProgreso,
  ahora: Date,
): SesionCruda[] {
  if (rango === "todo") return sesiones;
  if (rango === "10s") return sesiones.slice(-ULTIMAS_SESIONES);

  const limite = new Date(ahora);
  limite.setMonth(limite.getMonth() - (rango === "3m" ? 3 : 6));
  return sesiones.filter((sesion) => sesion.fecha.getTime() >= limite.getTime());
}

function aSesionProgreso(
  sesion: SesionCruda,
  numero: number,
): SesionProgreso {
  const datos = sesion.datos;
  return {
    sesionId: sesion.sesionId,
    fecha: sesion.fecha.toISOString(),
    numero,
    intensidadEmocional: datos?.intensidadEmocional ?? null,
    alianzaTerapeutica: datos?.alianzaTerapeutica ?? null,
    temas: datos?.temas ?? [],
    nivelRiesgo: datos?.riesgoDetectado?.nivel ?? null,
    flagsRiesgo: datos?.flagsRiesgo ?? null,
    intervenciones: contarIntervenciones(datos?.intervenciones),
    observacionIA: datos?.observacionIA ?? null,
    progresoPercibido: datos?.progresoPercibido ?? null,
  };
}

/** Los temas de una sesión, sin repetidos y sin vacíos. */
function temasDe(sesion: SesionCruda): string[] {
  const limpios = (sesion.datos?.temas ?? [])
    .map((tema) => tema.trim())
    .filter((tema) => tema.length > 0);
  return [...new Set(limpios)];
}

/**
 * Tendencia de un tema: frecuencia en las últimas 5 sesiones contra la
 * frecuencia en todas las anteriores.
 *
 * - Si nunca apareció antes de esa ventana, es "nuevo".
 * - Si no hay bloque anterior (la paciente tiene 5 sesiones o menos) todo lo
 *   que aparece es "nuevo": no hay contra qué comparar y decir "estable"
 *   sería afirmar algo que no se sabe.
 * - Después se comparan tasas, no conteos crudos: 3 de 5 sesiones recientes
 *   pesa más que 4 de 20 anteriores.
 */
function tendenciaDe(
  enRecientes: number,
  totalRecientes: number,
  enAnteriores: number,
  totalAnteriores: number,
): TendenciaTema {
  if (totalAnteriores === 0 || enAnteriores === 0) return "nuevo";

  const tasaReciente = totalRecientes === 0 ? 0 : enRecientes / totalRecientes;
  const tasaAnterior = enAnteriores / totalAnteriores;

  if (tasaReciente > tasaAnterior * (1 + UMBRAL_TENDENCIA)) return "sube";
  if (tasaReciente < tasaAnterior * (1 - UMBRAL_TENDENCIA)) return "baja";
  return "estable";
}

function armarTemas(sesiones: SesionCruda[]): TemaProgreso[] {
  const corte = Math.max(0, sesiones.length - VENTANA_TENDENCIA);
  const totalRecientes = sesiones.length - corte;
  const totalAnteriores = corte;

  type Acumulado = {
    conteo: number;
    primeraVez: string;
    ultimaVez: string;
    enRecientes: number;
    enAnteriores: number;
  };
  const porTema = new Map<string, Acumulado>();

  sesiones.forEach((sesion, indice) => {
    const fecha = sesion.fecha.toISOString();
    const reciente = indice >= corte;

    for (const tema of temasDe(sesion)) {
      const actual = porTema.get(tema);
      if (!actual) {
        porTema.set(tema, {
          conteo: 1,
          primeraVez: fecha,
          ultimaVez: fecha,
          enRecientes: reciente ? 1 : 0,
          enAnteriores: reciente ? 0 : 1,
        });
        continue;
      }
      actual.conteo += 1;
      actual.ultimaVez = fecha;
      if (reciente) actual.enRecientes += 1;
      else actual.enAnteriores += 1;
    }
  });

  return [...porTema.entries()]
    .map(([tema, acumulado]) => ({
      tema,
      conteo: acumulado.conteo,
      deTotal: sesiones.length,
      primeraVez: acumulado.primeraVez,
      ultimaVez: acumulado.ultimaVez,
      tendencia: tendenciaDe(
        acumulado.enRecientes,
        totalRecientes,
        acumulado.enAnteriores,
        totalAnteriores,
      ),
    }))
    // Los más frecuentes primero; a igual conteo, el que se tocó más
    // recientemente; y a igual fecha, alfabético, para que el orden no
    // dependa del orden de inserción.
    .sort(
      (a, b) =>
        b.conteo - a.conteo ||
        b.ultimaVez.localeCompare(a.ultimaVez) ||
        a.tema.localeCompare(b.tema),
    )
    .slice(0, TOPE_TEMAS);
}

/**
 * La línea de tiempo de señales de riesgo: una entrada por flag activo por
 * sesión. El nivel y la cita salen de `riesgoDetectado` (contrato de riesgo
 * clínico); si no hay evidencia citada se usa el `detalle` de los flags.
 *
 * Una sesión con nivel graduado pero sin ningún flag activo no genera
 * entradas acá: su nivel se ve en `sesiones[].nivelRiesgo`.
 */
function armarRiesgos(sesiones: SesionCruda[]): RiesgoProgreso[] {
  const riesgos: RiesgoProgreso[] = [];

  for (const sesion of sesiones) {
    const flags = sesion.datos?.flagsRiesgo;
    if (!flags) continue;

    const riesgo = sesion.datos?.riesgoDetectado;
    const cita = riesgo?.evidencia?.[0]?.quote ?? flags.detalle ?? null;
    const fecha = sesion.fecha.toISOString();

    for (const flag of flagRiesgoSchema.options) {
      if (!flags[flag]) continue;
      riesgos.push({
        sesionId: sesion.sesionId,
        fecha,
        flag,
        nivel: riesgo?.nivel ?? null,
        cita: cita && cita.length > 0 ? cita : null,
      });
    }
  }

  return riesgos;
}

export interface ProgresoClinicoParams {
  pacienteId: string;
  /** Todas las sesiones con nota, ya ordenadas de la más vieja a la más nueva. */
  sesiones: SesionCruda[];
  rango: RangoProgreso;
  ahora: Date;
}

export function armarProgresoClinico({
  pacienteId,
  sesiones,
  rango,
  ahora,
}: ProgresoClinicoParams): ProgresoClinico {
  // El número de sesión se fija sobre la lista completa antes de recortar:
  // el rango cambia qué se ve, nunca cómo se llama cada sesión.
  const numeroDe = new Map(
    sesiones.map((sesion, indice) => [sesion.sesionId, indice + 1]),
  );

  return {
    pacienteId,
    totalSesiones: sesiones.length,
    rango,
    sesiones: recortarPorRango(sesiones, rango, ahora).map((sesion) =>
      aSesionProgreso(sesion, numeroDe.get(sesion.sesionId) ?? 0),
    ),
    temas: armarTemas(sesiones),
    riesgos: armarRiesgos(sesiones),
  };
}
