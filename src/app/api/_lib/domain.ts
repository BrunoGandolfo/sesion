import type {
  Configuracion as PrismaConfiguracion,
  Paciente as PrismaPaciente,
  Recordatorio as PrismaRecordatorio,
  Turno as PrismaTurno,
} from "@prisma/client";
import type {
  Configuracion,
  DeudaPaciente,
  Duracion,
  MetodoPago,
  Modalidad,
  PacienteConDeuda,
  PagoEstado,
  Recordatorio,
  Turno,
  TurnoConPaciente,
  TurnoEstado,
} from "@/types/domain";
// Solo el tipo del cliente (extendido con cifrado): este módulo no toca la
// base por sí mismo, la recibe como parámetro en buscarTurnosConDeuda.
import type { db } from "@/lib/db";
import { diasEnterosMvd } from "@/lib/fechas-montevideo";
import { normalizarRecordatorioModo } from "@/lib/recordatorios-programacion";

type TurnoStats = Pick<
  PrismaTurno,
  "fecha" | "estado" | "pagoEstado" | "tarifaCobrada"
>;

export type PacienteWithStats = PrismaPaciente & {
  turnos: TurnoStats[];
};

const DURACIONES: readonly Duracion[] = [30, 45, 50, 60, 90];
const MODALIDADES: readonly Modalidad[] = ["presencial", "online"];
const TURNO_ESTADOS: readonly TurnoEstado[] = [
  "programado",
  "realizado",
  "cancelado",
  "ausente",
];
const PAGO_ESTADOS: readonly PagoEstado[] = ["pendiente", "pagado"];
const METODOS_PAGO: readonly MetodoPago[] = [
  "efectivo",
  "transferencia",
  "mercadopago",
  "debito",
  "credito",
  "otro",
];

/** El valor si pertenece a la unión; el default si no. */
function unionODefault<T extends string | number>(
  valores: readonly T[],
  valor: unknown,
  fallback: T,
): T {
  return valores.includes(valor as T) ? (valor as T) : fallback;
}

export function toPacienteConDeuda(
  paciente: PacienteWithStats,
): PacienteConDeuda {
  const realizadas = paciente.turnos.filter(
    (turno) => turno.estado === "realizado",
  );
  const pagadas = paciente.turnos.filter(
    (turno) => turno.pagoEstado === "pagado",
  );
  const impagas = paciente.turnos.filter(esDeudaPendiente);

  return {
    ...paciente,
    sesionesRealizadas: realizadas.length,
    totalCobrado: sumTarifas(pagadas),
    sesionesImpagas: impagas.length,
    deudaTotal: sumTarifas(impagas),
    ultimaSesion: maxFecha(realizadas),
  };
}

/**
 * Fila de turno → tipo del dominio. Mismo criterio que toConfiguracion: en DB
 * `duracion` es Int y `modalidad`, `estado`, `pagoEstado` y `pagoMetodo` son
 * String (sin enum en la migración), así que acá se narrowean a su unión con
 * fallback al default de la migración ante valores desconocidos. Antes esto
 * era un `as unknown as Turno`, que le mentía al resto de la app: una fila
 * con `estado: "borrador"` viajaba tipada como TurnoEstado y nadie se
 * enteraba hasta que la pantalla mostraba un chip vacío.
 */
export function toTurno(turno: PrismaTurno): Turno {
  return {
    ...turno,
    duracion: unionODefault(DURACIONES, turno.duracion, 50),
    modalidad: unionODefault(MODALIDADES, turno.modalidad, "presencial"),
    estado: unionODefault(TURNO_ESTADOS, turno.estado, "programado"),
    pagoEstado: unionODefault(PAGO_ESTADOS, turno.pagoEstado, "pendiente"),
    // `pagoMetodo` es nullable en DB: null es un valor legítimo (sin cobrar),
    // no un desconocido; solo se cae a "otro" si trae un método que no existe.
    pagoMetodo:
      turno.pagoMetodo === null
        ? null
        : unionODefault(METODOS_PAGO, turno.pagoMetodo, "otro"),
  };
}

export function toTurnoConPaciente(
  turno: PrismaTurno & {
    paciente: Pick<PrismaPaciente, "id" | "nombre" | "apellido" | "telefono">;
  },
): TurnoConPaciente {
  return {
    ...toTurno(turno),
    paciente: turno.paciente,
  };
}

export function toRecordatorio(recordatorio: PrismaRecordatorio): Recordatorio {
  return recordatorio as Recordatorio;
}

/**
 * Fila de configuración → tipo del dominio. `Configuracion` ya declara
 * `recordatorioModo`, así que la API no tiene una forma propia: el alias
 * `ConfiguracionApi` que existía acá era el mismo tipo con otro nombre.
 */
export function toConfiguracion(
  configuracion: PrismaConfiguracion,
): Configuracion {
  // En DB orientacionTeorica y recordatorioModo son String (sin enum en la
  // migración); acá se narrowean a su unión, con fallback al default ante
  // valores desconocidos — misma regla que el contrato multi-orientación.
  return {
    ...configuracion,
    orientacionTeorica:
      configuracion.orientacionTeorica === "gestalt" ? "gestalt" : "cbt_mi",
    recordatorioModo: normalizarRecordatorioModo(
      configuracion.recordatorioModo,
    ),
  };
}

export function sumTarifas(turnos: TurnoStats[]) {
  return turnos.reduce((total, turno) => total + turno.tarifaCobrada, 0);
}

export function maxFecha(turnos: TurnoStats[]) {
  if (turnos.length === 0) return null;
  return turnos.reduce<Date | null>((latest, turno) => {
    if (!latest || turno.fecha > latest) return turno.fecha;
    return latest;
  }, null);
}

export function minFecha(turnos: TurnoStats[]) {
  if (turnos.length === 0) return null;
  return turnos.reduce<Date | null>((earliest, turno) => {
    if (!earliest || turno.fecha < earliest) return turno.fecha;
    return earliest;
  }, null);
}

// ────────────────────────────────────────────────────────────────────────────
// Antigüedad de la deuda — en días de calendario de Montevideo, no del
// proceso: en Vercel, que corre en UTC, una sesión de las 21:30 de Montevideo
// caía al día siguiente.
//
// Acá vivían además startOfDay/endOfDay/startOfMonth/endOfMonth/addDays: cinco
// envoltorios de una línea sobre fechas-montevideo que solo agregaban un
// nombre en inglés y un salto más para llegar a la fuente de verdad. Quien las
// usaba importa ahora de @/lib/fechas-montevideo directo.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Días enteros transcurridos desde la fecha del turno hasta hoy, contados
 * por día de calendario de Montevideo (no por períodos de 24 horas).
 * Devuelve 0 si la fecha es de hoy o futura.
 */
export function diasDesde(fecha: Date | null, ahora: Date): number {
  if (!fecha) return 0;
  return Math.max(0, diasEnterosMvd(fecha, ahora));
}

// ────────────────────────────────────────────────────────────────────────────
// Deuda — única fuente de la regla "sesión impaga": turno realizado con pago
// pendiente. Ya no se reescribe en ningún lado: la llaman toPacienteConDeuda
// y calcularDeudores acá, la query de buscarTurnosConDeuda la aplica en SQL,
// y de la UI la usan datos.ts (Hoy), ficha-tab, sesiones-tab y
// turnos-pagos-tab. Un cambio de la regla se hace en esta función y nada más.
// ────────────────────────────────────────────────────────────────────────────

export function esDeudaPendiente(turno: {
  estado: string;
  pagoEstado: string;
}): boolean {
  return turno.estado === "realizado" && turno.pagoEstado === "pendiente";
}

export interface TurnoParaDeuda {
  pacienteId: string;
  paciente: { nombre: string; apellido: string };
  estado: string;
  pagoEstado: string;
  tarifaCobrada: number;
  duracionMin?: number;
  /** Fecha del turno. Si al menos un turno impago la trae, el deudor sale
   *  con `diasAtraso` (días desde el impago más antiguo). */
  fecha?: Date;
}

export interface DeudorAgrupado {
  pacienteId: string;
  nombre: string;
  apellido: string;
  sesionesImpagas: number;
  montoTotal: number;
  minutosTotales: number;
  /** Solo presente cuando la entrada trae `fecha` (ver TurnoParaDeuda). */
  diasAtraso?: number;
}

/**
 * Agrupa por paciente los turnos que son deuda pendiente. Devuelve cantidad,
 * monto y minutos por paciente, ordenado por monto descendente (a igual
 * monto, orden de aparición). Sin tope: el tope lo aplica el consumidor.
 * Un paciente sin turnos impagos no aparece.
 *
 * Si los turnos traen `fecha`, cada deudor sale además con `diasAtraso`,
 * calculado con diasDesde() sobre el impago más antiguo respecto de `ahora`
 * (default: hoy). Sin `fecha` la salida es idéntica a la de antes.
 */
export function calcularDeudores(
  turnos: TurnoParaDeuda[],
  ahora: Date = new Date(),
): DeudorAgrupado[] {
  const porPaciente = new Map<string, DeudorAgrupado>();
  const impagoMasAntiguo = new Map<string, Date>();

  for (const turno of turnos) {
    if (!esDeudaPendiente(turno)) continue;
    const actual = porPaciente.get(turno.pacienteId) ?? {
      pacienteId: turno.pacienteId,
      nombre: turno.paciente.nombre,
      apellido: turno.paciente.apellido,
      sesionesImpagas: 0,
      montoTotal: 0,
      minutosTotales: 0,
    };
    actual.sesionesImpagas += 1;
    actual.montoTotal += turno.tarifaCobrada;
    actual.minutosTotales += turno.duracionMin ?? 0;
    porPaciente.set(turno.pacienteId, actual);

    if (turno.fecha) {
      const previa = impagoMasAntiguo.get(turno.pacienteId);
      if (!previa || turno.fecha < previa) {
        impagoMasAntiguo.set(turno.pacienteId, turno.fecha);
      }
    }
  }

  for (const [pacienteId, fecha] of impagoMasAntiguo) {
    const deudor = porPaciente.get(pacienteId);
    if (deudor) deudor.diasAtraso = diasDesde(fecha, ahora);
  }

  return [...porPaciente.values()].sort((a, b) => b.montoTotal - a.montoTotal);
}

// ────────────────────────────────────────────────────────────────────────────
// Deudores — query única y forma de respuesta de /api/deudores.
// ────────────────────────────────────────────────────────────────────────────

/** Item de /api/deudores: DeudaPaciente más lo que la UI de finanzas
 *  necesita para el recordatorio de cobro (teléfono para wa.me y minutos
 *  impagos para "Trabajaste X horas gratis"). */
export type DeudoresApiItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
};

/** Turno con deuda pendiente tal como lo devuelve buscarTurnosConDeuda. */
export interface TurnoConDeuda extends TurnoParaDeuda {
  fecha: Date;
  duracionMin: number;
  paciente: { nombre: string; apellido: string; telefono: string };
}

/**
 * Query única de los turnos que son deuda pendiente de una organización
 * (regla esDeudaPendiente aplicada en la propia consulta). La consumen
 * /api/dashboard y /api/deudores, que después pasan el resultado por
 * calcularDeudores y aplican cada uno su orden y su tope.
 */
export async function buscarTurnosConDeuda(
  prisma: typeof db,
  organizationId: string,
): Promise<TurnoConDeuda[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      organizationId,
      estado: "realizado",
      pagoEstado: "pendiente",
    },
    select: {
      pacienteId: true,
      fecha: true,
      estado: true,
      pagoEstado: true,
      tarifaCobrada: true,
      duracion: true,
      paciente: {
        select: { nombre: true, apellido: true, telefono: true },
      },
    },
  });

  return turnos.map((turno) => ({
    pacienteId: turno.pacienteId,
    paciente: turno.paciente,
    estado: turno.estado,
    pagoEstado: turno.pagoEstado,
    tarifaCobrada: turno.tarifaCobrada,
    duracionMin: turno.duracion,
    fecha: turno.fecha,
  }));
}
