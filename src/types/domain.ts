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
