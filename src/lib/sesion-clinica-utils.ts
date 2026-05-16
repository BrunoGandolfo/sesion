import type {
  AlianzaTerapeutica,
  ConfianzaModelo,
  DatosEstructurados,
  EstadoProcesamiento,
  FlagsRiesgo,
  IntervencionTerapeuta,
  NotaSOAP,
  SesionClinicaResponse,
} from "@/types/domain";

// Mantener sincronizado con el endpoint PATCH /api/sesion-clinica/[id].
// revision/aprobado no transicionan vía PATCH: aprobado se setea en el
// endpoint dedicado /aprobar.
const TRANSICIONES_PERMITIDAS: Record<
  EstadoProcesamiento,
  ReadonlyArray<EstadoProcesamiento>
> = {
  pendiente: ["grabando"],
  grabando: ["subiendo"],
  subiendo: ["procesando"],
  procesando: ["revision", "error"],
  revision: [],
  aprobado: [],
  error: ["procesando"],
};

export function esTransicionValida(
  estadoActual: EstadoProcesamiento,
  estadoNuevo: EstadoProcesamiento,
): boolean {
  return TRANSICIONES_PERMITIDAS[estadoActual].includes(estadoNuevo);
}

const ALIANZAS_VALIDAS: ReadonlyArray<AlianzaTerapeutica> = [
  "fragil",
  "inestable",
  "estable",
  "fuerte",
];

const CONFIANZAS_VALIDAS: ReadonlyArray<ConfianzaModelo> = [
  "alta",
  "media",
  "baja",
];

const INTERVENCIONES_VALIDAS: ReadonlyArray<IntervencionTerapeuta["tipo"]> = [
  "reformulacion",
  "senalamiento",
  "confrontacion",
  "interpretacion",
  "pregunta_circular",
  "validacion",
  "silencio_terapeutico",
  "otra",
];

function esAlianzaValida(value: unknown): value is AlianzaTerapeutica {
  return (
    typeof value === "string" &&
    (ALIANZAS_VALIDAS as ReadonlyArray<string>).includes(value)
  );
}

function esConfianzaValida(value: unknown): value is ConfianzaModelo {
  return (
    typeof value === "string" &&
    (CONFIANZAS_VALIDAS as ReadonlyArray<string>).includes(value)
  );
}

function esArrayDeStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function esRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function esTimestampAproxValido(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const segundos = Number(match[2]);
  return segundos >= 0 && segundos <= 59;
}

function esIntervencionValida(value: unknown): value is IntervencionTerapeuta {
  if (!esRecord(value)) {
    return false;
  }

  return (
    typeof value.tipo === "string" &&
    (INTERVENCIONES_VALIDAS as ReadonlyArray<string>).includes(value.tipo) &&
    typeof value.descripcion === "string" &&
    esTimestampAproxValido(value.timestampAprox)
  );
}

function esArrayDeIntervenciones(
  value: unknown,
): value is IntervencionTerapeuta[] {
  return Array.isArray(value) && value.every(esIntervencionValida);
}

function esFlagsRiesgoValido(value: unknown): value is FlagsRiesgo {
  if (!esRecord(value)) {
    return false;
  }

  return (
    typeof value.ideacionSuicida === "boolean" &&
    typeof value.autolesion === "boolean" &&
    typeof value.violenciaTerceros === "boolean" &&
    typeof value.sintomasPsicoticos === "boolean" &&
    typeof value.crisisPanico === "boolean" &&
    typeof value.detalle === "string"
  );
}

export function parseDatosEstructurados(
  json: string | null,
): DatosEstructurados | null {
  if (json === null) return null;
  if (json.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const intensidad = obj.intensidadEmocional;
  const duracionRealMin = obj.duracionRealMin;
  if (
    typeof intensidad !== "number" ||
    !Number.isFinite(intensidad) ||
    intensidad < 1 ||
    intensidad > 10
  ) {
    return null;
  }

  if (
    typeof duracionRealMin !== "number" ||
    !Number.isFinite(duracionRealMin) ||
    duracionRealMin < 0
  ) {
    return null;
  }

  if (!esAlianzaValida(obj.alianzaTerapeutica)) return null;
  if (!esConfianzaValida(obj.confianzaModelo)) return null;
  if (!esArrayDeStrings(obj.temas)) return null;
  if (!esArrayDeStrings(obj.emocionesPaciente)) return null;
  if (!esArrayDeIntervenciones(obj.intervenciones)) return null;
  if (!esArrayDeStrings(obj.compromisos)) return null;
  if (!esArrayDeStrings(obj.materialRecurrente)) return null;
  if (!esArrayDeStrings(obj.materialNuevo)) return null;
  if (!esFlagsRiesgoValido(obj.flagsRiesgo)) return null;
  if (typeof obj.progresoPercibido !== "string") return null;
  if (typeof obj.focoProximaSesion !== "string") return null;
  if (typeof obj.resumenSesion !== "string") return null;
  if (typeof obj.estadoEmocionalObservado !== "string") return null;

  return {
    temas: obj.temas,
    emocionesPaciente: obj.emocionesPaciente,
    intensidadEmocional: intensidad,
    alianzaTerapeutica: obj.alianzaTerapeutica,
    intervenciones: obj.intervenciones,
    compromisos: obj.compromisos,
    materialRecurrente: obj.materialRecurrente,
    materialNuevo: obj.materialNuevo,
    focoProximaSesion: obj.focoProximaSesion,
    flagsRiesgo: obj.flagsRiesgo,
    confianzaModelo: obj.confianzaModelo,
    resumenSesion: obj.resumenSesion,
    estadoEmocionalObservado: obj.estadoEmocionalObservado,
    duracionRealMin,
    progresoPercibido: obj.progresoPercibido,
  };
}

export function esNotaCompleta(nota: Partial<NotaSOAP>): boolean {
  return Boolean(
    nota.subjetivo?.trim() &&
      nota.objetivo?.trim() &&
      nota.analisis?.trim() &&
      nota.plan?.trim(),
  );
}

// Versión permisiva (sin validación de shape): acepta el objeto ya
// deserializado por la extensión Prisma o el string JSON crudo de filas
// legacy. Para inputs de fronteras no confiables, usar parseDatosEstructurados.
export function coerceDatosEstructurados(
  value: DatosEstructurados | string | null | undefined,
): DatosEstructurados | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as DatosEstructurados;
  } catch {
    return null;
  }
}

// Retorna null SOLO si los cuatro campos están ausentes; si al menos uno
// trae valor, los faltantes se completan con "".
export function ensamblarNotaSOAP(campos: {
  subjetivo?: string | null;
  objetivo?: string | null;
  analisis?: string | null;
  plan?: string | null;
}): NotaSOAP | null {
  const { subjetivo, objetivo, analisis, plan } = campos;
  if (
    subjetivo == null &&
    objetivo == null &&
    analisis == null &&
    plan == null
  ) {
    return null;
  }
  return {
    subjetivo: subjetivo ?? "",
    objetivo: objetivo ?? "",
    analisis: analisis ?? "",
    plan: plan ?? "",
  };
}

export interface RawSesionClinica {
  id: string;
  turnoId: string;
  estado: EstadoProcesamiento | string;
  duracionAudioSeg: number | null;
  nota?: NotaSOAP | null;
  notaSubjetivo?: string | null;
  notaObjetivo?: string | null;
  notaAnalisis?: string | null;
  notaPlan?: string | null;
  datosEstructurados?: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
}

export function normalizeSesionClinica(
  raw: RawSesionClinica,
): SesionClinicaResponse {
  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado as EstadoProcesamiento,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota:
      raw.nota ??
      ensamblarNotaSOAP({
        subjetivo: raw.notaSubjetivo,
        objetivo: raw.notaObjetivo,
        analisis: raw.notaAnalisis,
        plan: raw.notaPlan,
      }),
    datosEstructurados: coerceDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
  };
}
