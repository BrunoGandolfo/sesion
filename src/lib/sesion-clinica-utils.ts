import { esRiesgoDetectadoValido } from "@/types/domain";
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

export type EstadoSesion = EstadoProcesamiento;

export const ESTADOS_SESION: ReadonlyArray<EstadoSesion> = [
  "pendiente",
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobado",
  "error",
];

// ÚNICA fuente de verdad de la máquina de estados de SesionClinica. La
// consumen todos los endpoints que mutan `estado` (PATCH/DELETE de [id],
// upload, aprobar) vía assertTransicionValida() en src/app/api/_lib/
// sesion-clinica.ts. No duplicar esta tabla en las rutas.
//
// - grabando → subiendo: POST [id]/upload-url (guarda clave+IV y emite la
//   URL prefirmada de R2). Desde acá el navegador sube DIRECTO a R2.
// - subiendo → procesando: POST [id]/upload-confirmar, tras verificar con
//   HeadObject que el objeto existe en R2.
// - subiendo → grabando: reintento de la subida (cliente por PATCH, o el
//   propio upload-confirmar cuando el objeto no llegó a R2).
// - grabando → error / subiendo → error: descarte de una grabación abandonada
//   con audio subido (DELETE) o fallo de subida.
// - grabando → procesando: se conserva por compatibilidad con filas viejas;
//   ya no lo usa ninguna ruta (el /upload monolítico devuelve 410).
// - revision → error: descarte de la nota (DELETE), la sesión queda
//   reprocesable. revision → aprobado: solo el endpoint /aprobar.
// - error → procesando: reintento (PATCH), re-encola al worker.
const TRANSICIONES_PERMITIDAS: Record<
  EstadoSesion,
  ReadonlyArray<EstadoSesion>
> = {
  pendiente: ["grabando"],
  grabando: ["subiendo", "procesando", "error"],
  subiendo: ["procesando", "grabando", "error"],
  procesando: ["revision", "error"],
  revision: ["aprobado", "error"],
  aprobado: [],
  error: ["procesando"],
};

export function esEstadoSesion(value: unknown): value is EstadoSesion {
  return (
    typeof value === "string" &&
    (ESTADOS_SESION as ReadonlyArray<string>).includes(value)
  );
}

// Tolerante a strings desconocidos (filas con estado corrupto): un estado
// que no está en la tabla no puede transicionar a nada.
export function esTransicionValida(
  estadoActual: EstadoSesion | string,
  estadoNuevo: EstadoSesion | string,
): boolean {
  if (!esEstadoSesion(estadoActual) || !esEstadoSesion(estadoNuevo)) {
    return false;
  }
  return TRANSICIONES_PERMITIDAS[estadoActual].includes(estadoNuevo);
}

// Subconjunto de TRANSICIONES_PERMITIDAS que el navegador puede pedir
// directamente vía PATCH /api/sesion-clinica/[id] { estado }. Todo lo demás
// tiene una ruta con efectos propios y NO puede pedirse por PATCH:
//   grabando → subiendo             → POST [id]/upload-url (guarda clave+IV,
//                                     emite URL prefirmada). NO es de cliente:
//                                     la hace el servidor al emitir la URL.
//   subiendo → procesando           → POST [id]/upload-confirmar (HeadObject)
//   procesando → revision|error     → POST callback (M2M, escribe la nota)
//   revision → aprobado             → POST [id]/aprobar (chequeo de riesgo,
//                                     borrado de audio, destrucción de clave)
//   revision → error, grabando → error con audio → DELETE [id]
//
// Evidencia de uso real en el frontend (única fuente para esta lista):
//   pendiente → grabando : useGrabacionSesion.ts (iniciar) y
//                          historia-tab.tsx (iniciarGrabacionFlow), tras
//                          crear la sesión.
//   grabando → error     : historia-tab.tsx (manejarGrabacionCompleta) cuando
//                          falla la subida; el hook nuevo ya no lo usa, pero
//                          la pestaña Historia todavía sí.
//   subiendo → grabando  : useGrabacionSesion.ts (volverAGrabando) tras un
//                          fallo en el PUT a R2 o en la confirmación: la
//                          sesión vuelve a "grabando" para repetir desde
//                          upload-url con el mismo blob cifrado.
//   error → procesando   : useGrabacionSesion.ts (reintentar) e
//                          historia-tab.tsx, "Reintentar"; re-encola al
//                          worker vía /pendientes.
const TRANSICIONES_CLIENTE: Partial<
  Record<EstadoSesion, ReadonlyArray<EstadoSesion>>
> = {
  pendiente: ["grabando"],
  grabando: ["error"],
  subiendo: ["grabando"],
  error: ["procesando"],
};

// Key del objeto de audio cifrado en R2. Es determinística por sesión: el
// servidor la calcula al emitir la URL prefirmada y la vuelve a calcular al
// confirmar, y solo acepta la que coincide (nunca una key arbitraria que
// mande el cliente).
export function keyAudioEsperada(
  organizationId: string,
  sesionClinicaId: string,
  turnoId: string,
): string {
  return `audio/${organizationId}/${sesionClinicaId}/${turnoId}.enc`;
}

export function esKeyAudioDeSesion(
  key: unknown,
  organizationId: string,
  sesionClinicaId: string,
  turnoId: string,
): boolean {
  return (
    typeof key === "string" &&
    key === keyAudioEsperada(organizationId, sesionClinicaId, turnoId)
  );
}

export function esTransicionPermitidaAlCliente(
  estadoActual: EstadoSesion | string,
  estadoNuevo: EstadoSesion | string,
): boolean {
  if (!esTransicionValida(estadoActual, estadoNuevo)) return false;
  const permitidas = TRANSICIONES_CLIENTE[estadoActual as EstadoSesion] ?? [];
  return permitidas.includes(estadoNuevo as EstadoSesion);
}

// Umbral para considerar abandonada una sesión en "grabando": una sesión
// real dura máx ~90 min; con margen amplio, >4 h sin actualización significa
// que el navegador murió y el audio nunca se subió.
export const UMBRAL_HUERFANA_HORAS = 4;

const UMBRAL_HUERFANA_MS = UMBRAL_HUERFANA_HORAS * 60 * 60 * 1000;

function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fuente de verdad única de la regla de "sesión huérfana".
 *
 * - estado "error": siempre huérfana (el pipeline murió; requiere acción
 *   de la usuaria: reintentar o descartar).
 * - estado "grabando": huérfana si la última actualización (updatedAt,
 *   con fallback a createdAt) fue hace más de UMBRAL_HUERFANA_HORAS.
 *   Si no hay timestamp disponible NO se considera huérfana — default
 *   seguro: nunca ofrecer descartar una grabación posiblemente activa.
 */
export function esSesionHuerfana(sesion: {
  estado: EstadoProcesamiento | string;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}): boolean {
  if (sesion.estado === "error") return true;
  if (sesion.estado !== "grabando") return false;

  const referencia =
    toEpochMs(sesion.updatedAt) ?? toEpochMs(sesion.createdAt);
  if (referencia === null) return false;

  return Date.now() - referencia > UMBRAL_HUERFANA_MS;
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

  // riesgoDetectado es OPCIONAL en todos los niveles (contrato de riesgo
  // clínico): su ausencia o un shape inválido NUNCA invalidan el objeto —
  // se omite y los lectores normalizan con normalizarRiesgo() (nivel
  // "ninguno"). Un datosEstructurados legacy pasa igual que antes.
  const riesgoDetectado = esRiesgoDetectadoValido(obj.riesgoDetectado)
    ? obj.riesgoDetectado
    : undefined;

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
    ...(riesgoDetectado !== undefined ? { riesgoDetectado } : {}),
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
