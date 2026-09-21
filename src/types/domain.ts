// ============================================
// SESIÓN — Tipos del dominio
// Fuente de verdad para toda la aplicación.
// Si algo cambia acá, cambia en todos lados.
//
// Excepciones, que acá solo se re-exportan para que los importadores
// existentes sigan compilando:
//   - el contrato de sesión clínica (estados, nota SOAP, datos
//     estructurados, enumeraciones de riesgo/alianza/intervención) vive en
//     src/lib/sesion-clinica/schema.ts (Zod, única definición);
//   - las listas cerradas del turno (duración, modalidad, estados, método
//     de pago, frecuencia de serie) viven en src/lib/constantes-turno.ts.
// ============================================

import type {
  Duracion,
  EstadoPago,
  EstadoTurno,
  FrecuenciaSerie,
  MetodoPago,
  Modalidad,
} from "@/lib/constantes-turno";
import type { RecordatorioModo } from "@/lib/recordatorios-programacion";
import type {
  AlianzaTerapeutica,
  ConfianzaModelo,
  DatosEstructurados as DatosEstructuradosSchema,
  EstadoSesion,
  NivelRiesgo,
  NotaSoap,
} from "@/lib/sesion-clinica/schema";

export type {
  Duracion,
  FrecuenciaSerie,
  FrecuenciaTurno,
  MetodoPago,
  Modalidad,
} from "@/lib/constantes-turno";

/** Estados del ciclo de vida de un turno (nombre histórico de EstadoTurno). */
export type TurnoEstado = EstadoTurno;

/** Estados de pago de una sesión realizada (nombre histórico de EstadoPago). */
export type PagoEstado = EstadoPago;

/**
 * Estados del recordatorio por SMS.
 *
 * "enviando" es la RESERVA del cron: una corrida lo tomó y lo está
 * trabajando. No dice que se haya llamado a Twilio — eso lo dice `intentos`.
 * Si la corrida se corta, la fila queda ahí y la siguiente la rescata (ver
 * src/app/api/_lib/casos-uso/enviar-recordatorios.ts). En la base `estado` es
 * un String sin enum, así que este valor no necesita migración.
 */
export type RecordatorioEstado =
  | "pendiente"
  | "enviando"
  | "enviado"
  | "fallido"
  | "cancelado";

// ============================================
// Entidades
// ============================================

export interface Paciente {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;        // formato +5989XXXXXXX
  tarifa: number;           // en UYU, sin centavos
  /** Notas privadas de la ficha. En la base van cifradas (notas_encrypted);
   *  acá llegan ya en claro por la extensión de Prisma. */
  notas: string | null;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
  organizationId: string;
}

export interface Turno {
  id: string;
  pacienteId: string;
  fecha: Date;              // fecha y hora del turno
  duracion: Duracion;
  modalidad: Modalidad;
  estado: TurnoEstado;
  tarifaCobrada: number;    // congelada al crear el turno
  pagoEstado: PagoEstado;
  pagoFecha: Date | null;
  pagoMetodo: MetodoPago | null;
  /** Nota privada del turno. Cifrada en la base, en claro acá. */
  notas: string | null;
  /** null = turno suelto. Un turno de una serie sigue siendo independiente
   *  (moverlo, cobrarlo o cancelarlo es lo mismo que para uno suelto); el
   *  id solo sirve para "cancelar el resto de la serie desde acá". */
  serieId: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
  organizationId: string;
}

/** La serie que creó POST /api/turnos cuando se pidió repetir el turno. */
export interface SerieCreada {
  id: string;
  frecuencia: FrecuenciaSerie;
  /** Turnos que quedaron agendados, contando el primero. */
  creados: number;
  /** Fechas de la serie que chocaban con otro turno y no se agendaron. Por
   *  la red llegan como ISO; en el servidor son Date. */
  omitidas: Date[];
}

/** `data` de POST /api/turnos: el turno, más la serie si se pidió una. Es un
 *  Turno con un campo extra, así quien solo espera un Turno (la pantalla de
 *  grabar) sigue leyendo `id` y `fecha` igual. */
export type TurnoCreado = Turno & { serie: SerieCreada | null };

export interface Recordatorio {
  id: string;
  turnoId: string;
  programadoEn: Date;      // cuándo debe enviarse
  enviadoEn: Date | null;  // cuándo se envió realmente
  estado: RecordatorioEstado;
  textoEnviado: string | null;
  error: string | null;
  intentos: number;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface Configuracion {
  id: string;
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: number;    // en UYU
  /** Cuándo sale el recordatorio, dicho como momento y no como número de
   *  horas. La cuenta vive en src/lib/recordatorios-programacion.ts
   *  (calcularProgramadoEn), única para crear y para reprogramar turnos.
   *  En la base es el enum modo_recordatorio. */
  recordatorioModo: RecordatorioModo;
  templateRecordatorio: string;
  /** Orientación teórica de la profesional. Determina el instrumento de
   *  auto-supervisión (ver contrato multi-orientación). En la base es el
   *  enum orientacion_teorica. */
  orientacionTeorica: OrientacionTeorica;
  organizationId: string;
}

// ============================================
// Vistas derivadas (para UI)
// ============================================

export interface PacienteConDeuda extends Paciente {
  sesionesRealizadas: number;
  totalCobrado: number;
  sesionesImpagas: number;
  deudaTotal: number;
  ultimaSesion: Date | null;
}

export interface TurnoConPaciente extends Turno {
  sesionClinica: { id: string; estado: string } | null;
  paciente: Pick<Paciente, "id" | "nombre" | "apellido" | "telefono">;
}

export interface DeudaPaciente {
  pacienteId: string;
  nombre: string;
  apellido: string;
  sesionesImpagas: number;
  montoTotal: number;
  /** Días desde el turno realizado+pendiente más antiguo. 0 si es de hoy. */
  diasAtraso: number;
}

/**
 * Los tres números de la pantalla de Hoy, ni uno más. "Pacientes activos"
 * salió del tablero y con él la cuenta que lo alimentaba (ver
 * GET /api/dashboard): declararlo acá obligaba a la capa API a restarlo con
 * un Omit y dejaba a la UI creyendo que existía.
 */
export interface KPIsDashboard {
  sesionesHoy: number;
  deudaAcumulada: number;
  ingresosMes: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Pendientes de la terapeuta — forma de las tres listas que devuelve
// casos-uso/pendientes-terapeuta.ts y que viajan dentro de /api/dashboard.
//
// Las fechas van como string ISO, no como Date: son datos de sólo lectura
// que la pantalla formatea, y así el tipo dice la verdad sobre lo que
// llega por la red (Response.json ya serializa toda Date a ISO).
// ────────────────────────────────────────────────────────────────────────────

/** Nota generada por el pipeline que todavía nadie aprobó. */
export interface NotaParaRevisar {
  sesionId: string;
  turnoId: string;
  pacienteId: string;
  /** "Ana López" — nombre y apellido ya unidos. */
  pacienteNombre: string;
  /** Fecha y hora del turno, ISO. */
  fecha: string;
}

/**
 * Deuda de una paciente, no de un turno.
 *
 * Se cobra por persona, no por sesión: quien debe tres sesiones recibe un
 * mensaje, no tres. Por eso la lista llega agrupada y con el monto sumado,
 * y `masAntiguo` al lado, que es lo que dice cuán vieja es la deuda.
 */
export interface PacienteSinCobrar {
  pacienteId: string;
  pacienteNombre: string;
  /** Cuántas sesiones realizadas e impagas tiene. Siempre ≥ 1. */
  sesiones: number;
  /** Suma de las tarifas de esas sesiones. */
  monto: number;
  /** Fecha del turno impago más viejo, ISO. */
  masAntiguo: string;
}

/** El pie del bloque: cuánto es todo junto. */
export interface TotalSinCobrar {
  sesiones: number;
  monto: number;
  pacientes: number;
}

/** Turno de hoy cuya paciente no firmó la autorización de grabación. */
export interface TurnoSinAutorizacion {
  turnoId: string;
  pacienteId: string;
  pacienteNombre: string;
  fecha: string;
}

/**
 * Una sesión que se procesó y falló, y que sigue esperando una decisión.
 *
 * Hasta ahora una nota fallida no aparecía en ningún lado: Pendientes sólo
 * miraba las que están en `revision`, así que una sesión del martes que
 * falló el martes podía no enterarse nunca de que le falta la nota.
 */
export interface NotaFallida {
  sesionId: string;
  turnoId: string;
  pacienteId: string;
  /** "Ana López" — nombre y apellido ya unidos. */
  pacienteNombre: string;
  /** Fecha y hora del turno, ISO. */
  fecha: string;
  /** El código del fallo (`intentos_agotados`, `asr_vacio`…), o null si la
   *  fila quedó sin código. Nunca el detalle: ese texto es de diagnóstico. */
  codigo: string | null;
  /** Si todavía hay con qué volver a intentar (audio en R2 o transcripción
   *  ya hecha). En false, el único camino es eliminarla. */
  puedeReintentarse: boolean;
}

export interface PendientesTerapeuta {
  notasParaRevisar: NotaParaRevisar[];
  /** Agrupado por paciente, de la deuda más grande a la más chica. */
  sinCobrar: PacienteSinCobrar[];
  totalSinCobrar: TotalSinCobrar;
  sinAutorizacion: TurnoSinAutorizacion[];
  /**
   * Sesiones fallidas sin resolver, de cualquier fecha, de la más vieja a la
   * más nueva y con tope.
   *
   * OPCIONAL a propósito: el servidor lo manda siempre, pero dejarlo
   * obligatorio rompería el tipado de las pantallas que hoy arman un
   * `PendientesTerapeuta` a mano. Es un agregado, no un cambio de forma.
   */
  notasFallidas?: NotaFallida[];
}

/**
 * La señal de riesgo de una sesión, reducida a lo que hace falta para saber
 * si la hubo: el nivel graduado y los cinco booleanos.
 *
 * Va con la forma completa del contrato pero vacía de contenido —sin
 * indicadores, sin evidencia, sin nota para la terapeuta y sin el `detalle`
 * de los flags—: eso es material clínico y la pantalla de Hoy no lo muestra.
 * Las tres claves de más no son decorativas: sin ellas el guard de
 * `normalizarRiesgo` lee toda señal como "ninguno".
 */
export interface SenalRiesgoDelDia {
  riesgoDetectado: {
    nivel: unknown;
    indicadores: string[];
    evidencia: never[];
    notaParaTerapeuta: null;
  } | null;
  flagsRiesgo: FlagsRiesgo | null;
}

/**
 * Todo lo que devuelve GET /api/dashboard, que es lo que dibuja la pantalla
 * de Hoy. Vivía en el `_lib` privado de la API, pero lo importan tres
 * componentes de presentación (kpis, datos, pendientes): un tipo que cruza
 * la red y que leen los dos lados es dominio, no detalle de la ruta.
 */
export type DashboardData = {
  inicio: { tarifaCargada: boolean; tienePacientes: boolean; tieneTurnos: boolean };
  kpis: KPIsDashboard;
  sesionesHoy: TurnoConPaciente[];
  deudores: DeudaPaciente[];
  proximaSesion: TurnoConPaciente | null;
  /**
   * La señal de riesgo de cada sesión del día, para la regla dura del
   * personaje (docs/diseno/04-personaje.md): si alguna la tiene, Lupita no
   * aparece en Hoy ese día. Quien decide es `clavesDeRiesgo`
   * (RiesgoDetectadoBanner.tsx) en el cliente, con estos dos campos: la
   * regla sigue escrita en un solo lugar.
   */
  riesgoDelDia: SenalRiesgoDelDia[];
  /**
   * Lo que espera a la terapeuta: notas sin aprobar, sesiones sin cobrar y
   * turnos de hoy sin autorización de grabación (ver
   * casos-uso/pendientes-terapeuta.ts). Obligatorio: la pantalla de Hoy lo
   * consume desde que existe el bloque PENDIENTES.
   */
  pendientes: PendientesTerapeuta;
};

// ============================================
// Módulo de grabación + IA
//
// Definiciones en src/lib/sesion-clinica/schema.ts; acá solo re-exports y
// alias derivados de ese schema.
// ============================================

/** Estados del pipeline de procesamiento de una sesión clínica
 *  (pendiente → grabando → subiendo → procesando → revision → aprobado,
 *  más error). Alias de EstadoSesion del schema. */
export type EstadoProcesamiento = EstadoSesion;

/** Nivel de alianza terapéutica inferido por el LLM */
export type { AlianzaTerapeutica };

/** Confianza del modelo en la nota generada */
export type { ConfianzaModelo };

/** Nivel de la señal de riesgo. "ninguno" es el default seguro: sin
 *  evidencia textual explícita no se gradúa riesgo. */
export type { NivelRiesgo };

/** Nota clínica en formato SOAP */
export type NotaSOAP = NotaSoap;

/** Intervención del terapeuta detectada por IA. `timestampAprox` ("MM:SS")
 *  es opcional: el worker no siempre lo manda. */
export type IntervencionTerapeuta = NonNullable<
  DatosEstructuradosSchema["intervenciones"]
>[number];

/** Flags de riesgo clínico — cada uno requiere dismissal explícito.
 *  `detalle`: segmento textual donde se detectó, vacío si todos false. */
export type FlagsRiesgo = NonNullable<DatosEstructuradosSchema["flagsRiesgo"]>;

/** Señal de riesgo clínico graduada (ver docs/contrato-riesgo-clinico.md).
 *  Derivada SOLO de señales explícitas en la transcripción; coexiste con
 *  FlagsRiesgo sin reemplazarlo. El sistema señala, NUNCA diagnostica. */
export type RiesgoDetectado = NonNullable<
  DatosEstructuradosSchema["riesgoDetectado"]
>;

/** Cita literal de la transcripción que ancla un indicador de riesgo */
export type EvidenciaRiesgo = RiesgoDetectado["evidencia"][number];

/** Speech analytics derivado de diarización (ratios en 0-100;
 *  `speakersDetectados` < 2 = colapso; ausente en payloads legacy). */
export type SpeechAnalytics = NonNullable<
  DatosEstructuradosSchema["speechAnalytics"]
>;

// ============================================
// Feedback terapeuta (Llamada C) — contrato multi-orientación
//
// El instrumento de auto-supervisión depende de la orientación teórica
// configurada (Configuracion.orientacionTeorica). El feedback es una
// unión discriminada por `instrumento`: núcleo panteórico común + bloque
// específico del instrumento. Ver docs/contrato-multi-orientacion.md.
//
// Shape MITI/CTS-R definido por processor/prompts/therapist_feedback_v1.0.md
// El schema del tablero lo transporta como `unknown`; la forma se valida al
// leer con normalizarFeedback (src/lib/sesion-clinica/normalizar.ts).
// ============================================

/** Orientación teórica de la profesional — determina el instrumento
 *  de auto-supervisión. Fuente de verdad: Configuracion.orientacionTeorica. */
export type OrientacionTeorica = "cbt_mi" | "gestalt";

/** Cita literal de la transcripción que ancla un score */
export interface EvidenciaFeedback {
  timestamp: string; // formato "MM:SS"
  quote: string;     // cita textual del segmento
}

/** Score MITI global (escala 1-5, default 3) o null si no determinable */
export interface ScoreMITIGlobal {
  score: number | null;          // 1-5; null cuando no hay material suficiente
  evidence: EvidenciaFeedback[]; // ≥1 si score no es null; vacío si null
  razon?: string;                // requerido si score es null
}

/** Score CTS-R (escala 0-6) o null si no determinable */
export interface ScoreCTSR {
  score: number | null;          // 0-6; null cuando no es evaluable
  evidence: EvidenciaFeedback[];
  razon?: string;
}

/** Globales MITI 4.2.1 — 4 escalas */
export interface MITIGlobales {
  cultivatingChangeTalk: ScoreMITIGlobal;
  softeningSustainTalk: ScoreMITIGlobal;
  partnership: ScoreMITIGlobal;
  empathy: ScoreMITIGlobal;
}

/** Conteos MITI 4.2.1 — 10 categorías de comportamiento */
export interface MITICounts {
  Q: number;   // Question
  SR: number;  // Simple Reflection
  CR: number;  // Complex Reflection
  AF: number;  // Affirm
  SC: number;  // Seeking Collaboration
  EA: number;  // Emphasizing Autonomy
  GI: number;  // Giving Information
  PWP: number; // Persuade with Permission
  P: number;   // Persuade
  C: number;   // Confront
}

export type BenchmarkMITI = "insufficient" | "fair" | "good";

export interface RatiosDerivadosMITI {
  rq: number | null;            // (SR + CR) / Q; null si Q === 0
  porcentajeCR: number | null;  // CR / (SR + CR) * 100; null si SR+CR === 0
  benchmarkRQ: BenchmarkMITI;
  benchmarkPorcentajeCR: BenchmarkMITI;
}

/** Subset CTS-R: 4 ítems factibles desde transcripción */
export interface CTSRSubset {
  agendaSetting: ScoreCTSR;
  feedback: ScoreCTSR;
  collaboration: ScoreCTSR;
  guidedDiscovery: ScoreCTSR;
}

export interface SpeechAnalyticsInferido {
  ratioHablaTerapeutaPaciente: number | null;
  comentario: string | null;
}

export interface FortalezaFeedback {
  descripcion: string;
  evidence: EvidenciaFeedback[];
}

export interface AreaCrecimientoFeedback {
  observacion: string; // qué se observó en la sesión
  sugerencia: string;  // qué probar la próxima vez
  evidence: EvidenciaFeedback[];
}

// ─── Núcleo panteórico ───────────────────────────────────────────────
// Común a TODA orientación teórica. Es lo que "Mi Práctica" puede cruzar
// longitudinalmente sin importar el instrumento con que se generó cada
// sesión. Los bloques específicos de instrumento extienden este núcleo.

export interface FeedbackNucleoPanteorico {
  fortalezas: FortalezaFeedback[];              // máx 3
  areasCrecimiento: AreaCrecimientoFeedback[];  // máx 3
  sugerenciaProximaSesion: string;
  speechAnalyticsInferido?: SpeechAnalyticsInferido;
  disclaimer: string;
}

// ─── Bloque específico MITI 4.2.1 + CTS-R (orientación cbt_mi) ───────

export interface FeedbackMitiCtsr extends FeedbackNucleoPanteorico {
  instrumento: "cbt_mi";
  mitiGlobales: MITIGlobales;
  mitiCounts: MITICounts;
  ratiosDerivados: RatiosDerivadosMITI;
  ctsrSubset: CTSRSubset;
}

// ─── Bloque específico GTFS (orientación gestalt) ────────────────────
// Gestalt Therapy Fidelity Scale — 21 ítems (Fogarty et al. 2019).
// Estructura preparada en Wave 1; los ítems concretos se definen en
// Wave 2 tras el análisis del instrumento original.

export interface ItemGTFS {
  id: string;            // identificador del ítem GTFS (ej. "gtfs_04")
  nombre: string;        // nombre corto del ítem en español
  score: number | null;  // escala GTFS; null si no inferible desde transcripción
  razon?: string;        // por qué null, si aplica
  evidence: EvidenciaFeedback[];
}

export interface FeedbackGestalt extends FeedbackNucleoPanteorico {
  instrumento: "gestalt";
  itemsGTFS: ItemGTFS[];
  adherenciaGlobal: number | null; // suma GTFS de ítems evaluables
}

// ─── Unión discriminada ──────────────────────────────────────────────

/** Reporte de auto-supervisión generado por la Llamada C.
 *  Unión discriminada por `instrumento`. Se embebe en datosEstructurados
 *  antes de persistir cifrado. */
export type FeedbackTerapeuta = FeedbackMitiCtsr | FeedbackGestalt;

// ─── Compatibilidad con datos persistidos pre-contrato ───────────────
// Las sesiones aprobadas antes del contrato multi-orientación guardaron
// el feedback SIN discriminador `instrumento` (siempre era MITI/CTS-R).
// Esos datos NO se migran: se normalizan al leer con normalizarFeedback().

/** Shape histórico del feedback (sin discriminador). Solo para lectura
 *  de sesiones persistidas antes del contrato multi-orientación. */
export interface FeedbackTerapeutaLegacy {
  mitiGlobales: MITIGlobales;
  mitiCounts: MITICounts;
  ratiosDerivados: RatiosDerivadosMITI;
  ctsrSubset: CTSRSubset;
  speechAnalyticsInferido: SpeechAnalyticsInferido;
  fortalezas: FortalezaFeedback[];              // máx 3
  areasCrecimiento: AreaCrecimientoFeedback[];  // máx 3
  sugerenciaProximaSesion: string;
  disclaimer: string;
}

// ─── Normalización al leer (implementación en src/lib/sesion-clinica/normalizar.ts)

/** @deprecated Importar desde "@/lib/sesion-clinica/normalizar". */
export {
  esFeedbackLegacy,
  esRiesgoDetectadoValido,
  normalizarFeedback,
  normalizarRiesgo,
} from "@/lib/sesion-clinica/normalizar";
