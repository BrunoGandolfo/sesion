// ============================================
// SESIÓN — Tipos del dominio
// Fuente de verdad para toda la aplicación.
// Si algo cambia acá, cambia en todos lados.
// ============================================

/** Estados del ciclo de vida de un turno */
export type TurnoEstado = "programado" | "realizado" | "cancelado" | "ausente";

/** Estados de pago de una sesión realizada */
export type PagoEstado = "pendiente" | "pagado";

/** Métodos de pago aceptados */
export type MetodoPago =
  | "efectivo"
  | "transferencia"
  | "mercadopago"
  | "debito"
  | "credito"
  | "otro";

/** Modalidad de la sesión */
export type Modalidad = "presencial" | "online";

/** Duraciones permitidas en minutos */
export type Duracion = 30 | 45 | 50 | 60 | 90;

/** Estados del recordatorio de WhatsApp */
export type RecordatorioEstado = "pendiente" | "enviado" | "fallido" | "cancelado";

// ============================================
// Entidades
// ============================================

export interface Paciente {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;        // formato +5989XXXXXXX
  email: string | null;
  tarifa: number;           // en UYU, sin centavos
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
  notas: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
  organizationId: string;
}

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
  horasAnticipacion: number; // default 24
  templateRecordatorio: string;
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
  paciente: Pick<Paciente, "id" | "nombre" | "apellido" | "telefono">;
}

export interface DeudaPaciente {
  pacienteId: string;
  nombre: string;
  apellido: string;
  sesionesImpagas: number;
  montoTotal: number;
}

export interface KPIsDashboard {
  pacientesActivos: number;
  sesionesHoy: number;
  deudaAcumulada: number;
  ingresosMes: number;
}

// ============================================
// Módulo de grabación + IA
// ============================================

/** Estados del pipeline de procesamiento de una sesión clínica */
export type EstadoProcesamiento =
  | "pendiente"    // creado, esperando grabación
  | "grabando"     // MediaRecorder activo en el browser
  | "subiendo"     // audio cifrado subiendo a R2
  | "procesando"   // La Escondida procesando (ASR + diarización + LLM)
  | "revision"     // nota generada, esperando aprobación de la profesional
  | "aprobado"     // nota aprobada por la profesional
  | "error";       // error en cualquier paso del pipeline

/** Nivel de alianza terapéutica inferido por el LLM */
export type AlianzaTerapeutica = "fragil" | "inestable" | "estable" | "fuerte";

/** Intervención del terapeuta detectada por IA */
export interface IntervencionTerapeuta {
  tipo:
    | "reformulacion"
    | "senalamiento"
    | "confrontacion"
    | "interpretacion"
    | "pregunta_circular"
    | "validacion"
    | "silencio_terapeutico"
    | "otra";
  descripcion: string;
  timestampAprox: string; // formato "MM:SS"
}

/** Flags de riesgo clínico — cada uno requiere dismissal explícito */
export interface FlagsRiesgo {
  ideacionSuicida: boolean;
  autolesion: boolean;
  violenciaTerceros: boolean;
  sintomasPsicoticos: boolean;
  crisisPanico: boolean;
  detalle: string; // Segmento textual donde se detectó, vacío si todos false
}

/** Confianza del modelo en la nota generada */
export type ConfianzaModelo = "alta" | "media" | "baja";

/** Datos estructurados extraídos por el LLM (versión enriquecida) */
export interface DatosEstructurados {
  // Campos originales
  temas: string[];
  emocionesPaciente: string[];
  intensidadEmocional: number; // 1-10
  alianzaTerapeutica: "fragil" | "inestable" | "estable" | "fuerte";
  compromisos: string[];
  progresoPercibido: string;

  // Campos nuevos
  intervenciones: IntervencionTerapeuta[];
  materialRecurrente: string[]; // Temas que ya aparecieron en sesiones anteriores
  materialNuevo: string[]; // Temas que aparecen por primera vez
  focoProximaSesion: string; // Sugerencia de foco para la próxima sesión
  flagsRiesgo: FlagsRiesgo;
  confianzaModelo: ConfianzaModelo;
  resumenSesion: string; // 200-300 palabras
  estadoEmocionalObservado: string; // 100-150 palabras
  duracionRealMin: number; // Duración real de la sesión en minutos
}

/** Nota clínica en formato SOAP */
export interface NotaSOAP {
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan: string;
}

// ============================================
// Requests
// ============================================

/** Iniciar grabación para un turno existente */
export interface IniciarGrabacionRequest {
  turnoId: string;
}

/** Subir chunk de audio cifrado al backend */
export interface SubirAudioRequest {
  sesionClinicaId: string;
  audioBase64: string;        // audio cifrado en base64
  duracionSegundos: number;
}

/** Aprobar (con o sin edición) una nota clínica generada */
export interface AprobarNotaRequest {
  sesionClinicaId: string;
  notaEditada?: NotaSOAP;     // presente si la profesional editó algo
  notasEdicion?: string;      // comentarios de la edición
}

/** Firmar el consentimiento informado de un paciente */
export interface FirmarConsentimientoRequest {
  pacienteId: string;
  firmaDigital: string;       // base64 del canvas de firma
}

// ============================================
// Responses
// ============================================

/** Estado actual de una sesión clínica (grabación + nota generada) */
export interface SesionClinicaResponse {
  id: string;
  turnoId: string;
  estado: EstadoProcesamiento;
  duracionAudioSeg: number | null;
  nota: NotaSOAP | null;
  datosEstructurados: DatosEstructurados | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;  // ISO date
  aprobadoEn: string | null;   // ISO date
  error: string | null;
}

/** Estado del consentimiento informado de un paciente */
export interface ConsentimientoResponse {
  id: string;
  pacienteId: string;
  firmadoEn: string;           // ISO date
  revocadoEn: string | null;   // ISO date, null = aún vigente
  textoVersion: string;
  vigente: boolean;            // computed: firmadoEn != null && revocadoEn == null
}

// ============================================
// Callbacks
// ============================================

/** Callback de La Escondida con el resultado del procesamiento */
export interface ResultadoProcesamientoCallback {
  sesionClinicaId: string;
  estado: "revision" | "error";
  transcripcion?: string;
  nota?: NotaSOAP;
  datosEstructurados?: DatosEstructurados;
  modeloASR?: string;
  modeloLLM?: string;
  error?: string;
}
