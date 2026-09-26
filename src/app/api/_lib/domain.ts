import type {
  Configuracion as PrismaConfiguracion,
  Paciente as PrismaPaciente,
  Turno as PrismaTurno,
} from "@prisma/client";
import type {
  Configuracion,
  DeudaPaciente,
  PacienteConDeuda,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";
import { esDuracion } from "@/lib/constantes-turno";
// Solo el tipo del cliente (extendido con cifrado): este módulo no toca la
// base por sí mismo, la recibe como parámetro en buscarTurnosConDeuda.
import type { db } from "@/lib/db";
import { diasEnterosMvd, esMismoDiaMvd } from "@/lib/fechas-montevideo";

type TurnoStats = Pick<
  PrismaTurno,
  "fecha" | "estado" | "pagoEstado" | "tarifaCobrada"
>;

/**
 * Fila de paciente como la entrega la extensión de cifrado: sin la columna
 * `notasEncrypted` y con el campo lógico `notas` en claro.
 */
type FilaPaciente = Omit<PrismaPaciente, "notasEncrypted"> & {
  notas: string | null;
};

type PacienteConTurnos = FilaPaciente & {
  turnos: TurnoStats[];
};

/** Ídem para el turno. */
type FilaTurno = Omit<PrismaTurno, "notasEncrypted"> & {
  notas: string | null;
};

/**
 * Los mappers arman el objeto campo por campo, sin spread de la fila: la
 * fila que llega de Prisma trae también `notasEncrypted` (el blob), y un
 * `...fila` lo mandaría al JSON de la respuesta. Que un campo nuevo de la
 * base no salga hasta que alguien lo agregue acá es a propósito.
 */
export function toPacienteConDeuda(
  paciente: PacienteConTurnos,
): PacienteConDeuda {
  const realizadas = paciente.turnos.filter(
    (turno) => turno.estado === "realizado",
  );
  const pagadas = paciente.turnos.filter(
    (turno) => turno.pagoEstado === "pagado",
  );
  const impagas = paciente.turnos.filter(esDeudaPendiente);

  return {
    id: paciente.id,
    nombre: paciente.nombre,
    apellido: paciente.apellido,
    telefono: paciente.telefono,
    tarifa: paciente.tarifa,
    notas: paciente.notas,
    activo: paciente.activo,
    creadoEn: paciente.creadoEn,
    actualizadoEn: paciente.actualizadoEn,
    organizationId: paciente.organizationId,
    sesionesRealizadas: realizadas.length,
    totalCobrado: sumTarifas(pagadas),
    sesionesImpagas: impagas.length,
    deudaTotal: sumTarifas(impagas),
    ultimaSesion: maxFecha(realizadas),
  };
}

/**
 * Fila de turno → tipo del dominio. `modalidad`, `estado`, `pagoEstado` y
 * `pagoMetodo` son enums de Postgres: Prisma ya los tipa con la unión y no
 * hay nada que narrowear. `duracion` es Int con CHECK en la migración
 * (IN (30, 45, 50, 60, 90), el mismo DURACIONES de constantes-turno): una
 * fila fuera de la lista es un invariante roto de la base, así que no se
 * corrige del lado de la app —el turno no sale, falla acá con el id a mano
 * y la ruta lo convierte en 500 por su try/catch—.
 */
export function toTurno(turno: FilaTurno): Turno {
  if (!esDuracion(turno.duracion)) {
    throw new Error(
      `turno ${turno.id} tiene duracion inválida: '${String(turno.duracion)}'`,
    );
  }
  return {
    id: turno.id,
    pacienteId: turno.pacienteId,
    fecha: turno.fecha,
    duracion: turno.duracion,
    modalidad: turno.modalidad,
    estado: turno.estado,
    tarifaCobrada: turno.tarifaCobrada,
    pagoEstado: turno.pagoEstado,
    pagoFecha: turno.pagoFecha,
    pagoMetodo: turno.pagoMetodo,
    notas: turno.notas,
    serieId: turno.serieId,
    creadoEn: turno.creadoEn,
    actualizadoEn: turno.actualizadoEn,
    organizationId: turno.organizationId,
  };
}

export function toTurnoConPaciente(
  turno: FilaTurno & {
    paciente: Pick<PrismaPaciente, "id" | "nombre" | "apellido" | "telefono">;
    sesionClinica: { id: string; estado: string; actualizadaEn?: Date } | null;
  },
): TurnoConPaciente {
  return {
    ...toTurno(turno),
    paciente: turno.paciente,
    sesionClinica: turno.sesionClinica,
  };
}

/**
 * Fila de configuración → tipo del dominio. `recordatorioModo` y
 * `orientacionTeorica` son enums de Postgres, tipados por Prisma.
 */
export function toConfiguracion(
  configuracion: PrismaConfiguracion,
): Configuracion {
  return {
    id: configuracion.id,
    nombreProfesional: configuracion.nombreProfesional,
    direccion: configuracion.direccion,
    whatsappOrigen: configuracion.whatsappOrigen,
    tarifaDefault: configuracion.tarifaDefault,
    recordatorioModo: configuracion.recordatorioModo,
    templateRecordatorio: configuracion.templateRecordatorio,
    orientacionTeorica: configuracion.orientacionTeorica,
    organizationId: configuracion.organizationId,
  };
}

function sumTarifas(turnos: TurnoStats[]) {
  return turnos.reduce((total, turno) => total + turno.tarifaCobrada, 0);
}

function maxFecha(turnos: TurnoStats[]) {
  if (turnos.length === 0) return null;
  return turnos.reduce<Date | null>((latest, turno) => {
    if (!latest || turno.fecha > latest) return turno.fecha;
    return latest;
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
// pendiente. La llaman toPacienteConDeuda y calcularDeudores acá, la query de
// buscarTurnosConDeuda la aplica en SQL, y de la UI la usan datos.ts (Hoy),
// ficha-tab, turnos-pagos-tab y cobros-view. Si se OFRECE cobrar es otra
// regla, más ancha: sePuedeCobrar, abajo.
//
// La regla estaba escrita DOS veces: acá como comparación y abajo, otra vez,
// como literal en el `where` de buscarTurnosConDeuda. Si alguien decidía que
// "ausente" también se cobra, la pantalla y la consulta podían quedar
// contando cosas distintas. Ahora la regla es UN dato —los valores que la
// hacen verdadera— y las dos formas derivan de él: la función lo compara y la
// consulta lo expande en el `where`. Un cambio de la regla se hace acá y en
// ningún otro lado.
// ────────────────────────────────────────────────────────────────────────────

/** Los valores que hacen que un turno sea deuda pendiente. */
export const DEUDA_PENDIENTE = {
  estado: "realizado",
  pagoEstado: "pendiente",
} as const;

export function esDeudaPendiente(turno: {
  estado: string;
  pagoEstado: string;
}): boolean {
  return (
    turno.estado === DEUDA_PENDIENTE.estado &&
    turno.pagoEstado === DEUDA_PENDIENTE.pagoEstado
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Qué se puede hacer con un turno — la regla que aplica el servidor, escrita
// una vez para que las pantallas ofrezcan exactamente lo que el servidor
// acepta. Antes el detalle de Agenda ofrecía Cobrar a un turno programado de
// más tarde y el servidor contestaba 400; y la hoja dejaba grabar un turno de
// ayer que el servidor tampoco impedía.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Si el turno se puede cobrar en `ahora`: sin cobrar y realizado, o sin
 * cobrar y programado con la hora ya llegada (cobrarlo lo cierra, ver
 * casos-uso/cobrar-turno.ts). Nunca cancelado, ausente ni pagado.
 *
 * Es más ancha que esDeudaPendiente: un programado cuya hora empezó se puede
 * cobrar pero todavía no es deuda.
 */
export function sePuedeCobrar(
  turno: { estado: string; pagoEstado: string; fecha: Date },
  ahora: Date,
): boolean {
  if (turno.pagoEstado !== "pendiente") return false;
  if (turno.estado === "realizado") return true;
  return (
    turno.estado === "programado" && turno.fecha.getTime() <= ahora.getTime()
  );
}

/**
 * Si se puede grabar el turno en `ahora`: programado o realizado, y del mismo
 * día de calendario de MONTEVIDEO que `ahora`. La hora no cuenta —una sesión
 * que empezó tarde se graba igual—; el día sí: un turno de ayer no se graba.
 *
 * Un turno que nace al grabar (`alGrabar` en POST /api/turnos) se crea con
 * la fecha del momento, así que es de hoy por construcción.
 */
export function sePuedeGrabar(
  turno: { estado: string; fecha: Date },
  ahora: Date,
): boolean {
  if (turno.estado !== "programado" && turno.estado !== "realizado") {
    return false;
  }
  return esMismoDiaMvd(turno.fecha, ahora);
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

interface DeudorAgrupado {
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
// Deuda por antigüedad — los mismos turnos, agrupados por cuánto hace que se
// dio la sesión. Lo usa Finanzas para decir "esto es de hace más de tres
// meses"; sale de la MISMA lista y la MISMA regla que /api/deudores y que
// Hoy, así que los tres números cierran por construcción.
// ────────────────────────────────────────────────────────────────────────────

/** Los tres tramos, del más nuevo al más viejo. El orden es el de la pantalla. */
export const TRAMOS_DEUDA = ["hasta30", "de31a90", "mas90"] as const;
export type TramoDeuda = (typeof TRAMOS_DEUDA)[number];

/** En qué tramo cae una deuda de `diasAtraso` días. Los bordes: 30 días
 *  justos son "hasta30" y 90 justos son "de31a90". */
export function tramoDeDeuda(diasAtraso: number): TramoDeuda {
  if (diasAtraso <= 30) return "hasta30";
  if (diasAtraso <= 90) return "de31a90";
  return "mas90";
}

export interface DeudaPorTramo {
  tramo: TramoDeuda;
  /** Sesiones impagas cuya fecha cae en el tramo. */
  sesiones: number;
  /** Suma de sus tarifas congeladas, en pesos enteros. */
  monto: number;
  /** Pacientes DISTINTAS con al menos una sesión en el tramo. Una paciente
   *  con deuda vieja y nueva cuenta en los dos tramos: no se pueden sumar
   *  los tres para saber cuántas deben. */
  pacientes: number;
}

/**
 * Reparte la deuda pendiente en los tres tramos por la antigüedad de la
 * SESIÓN (no del aviso ni del vencimiento: acá no hay vencimientos). Siempre
 * devuelve los tres tramos, con ceros si están vacíos: la pantalla dibuja
 * tres barras aunque dos estén en cero.
 */
export function deudaPorAntiguedad(
  turnos: TurnoParaDeuda[],
  ahora: Date = new Date(),
): DeudaPorTramo[] {
  const acumulado = new Map<TramoDeuda, { sesiones: number; monto: number; pacientes: Set<string> }>(
    TRAMOS_DEUDA.map((tramo) => [tramo, { sesiones: 0, monto: 0, pacientes: new Set<string>() }]),
  );

  for (const turno of turnos) {
    if (!esDeudaPendiente(turno)) continue;
    // Sin fecha no se puede fechar la deuda; cae en el tramo más nuevo, que
    // es el que menos alarma. diasDesde ya recorta los futuros a 0.
    const dias = turno.fecha ? diasDesde(turno.fecha, ahora) : 0;
    const acumulador = acumulado.get(tramoDeDeuda(dias))!;
    acumulador.sesiones += 1;
    acumulador.monto += turno.tarifaCobrada;
    acumulador.pacientes.add(turno.pacienteId);
  }

  return TRAMOS_DEUDA.map((tramo) => {
    const { sesiones, monto, pacientes } = acumulado.get(tramo)!;
    return { tramo, sesiones, monto, pacientes: pacientes.size };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Deudores — query única y forma de respuesta de /api/deudores.
// ────────────────────────────────────────────────────────────────────────────

/** Item de /api/deudores: DeudaPaciente más lo que la pantalla de Cobros
 *  necesita para el recordatorio (el teléfono al que sale el SMS, los
 *  minutos impagos y cuándo se avisó por última vez). */
export type DeudoresApiItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
  /** Cuándo salió el último aviso de cobro que se envió, ISO; null si nunca
   *  se le avisó. Sale de los eventos de auditoría (ver
   *  casos-uso/recordar-cobro.ts): es lo que la pantalla muestra como
   *  "Avisado hace N días" para no mandar el mismo SMS dos veces. */
  ultimoAvisoEn: string | null;
};

/** Turno con deuda pendiente tal como lo devuelve buscarTurnosConDeuda. */
export interface TurnoConDeuda extends TurnoParaDeuda {
  fecha: Date;
  duracionMin: number;
  paciente: { nombre: string; apellido: string; telefono: string };
}

/**
 * Query única de los turnos que son deuda pendiente de una organización
 * (DEUDA_PENDIENTE, la misma regla que esDeudaPendiente, en la consulta). La consumen
 * /api/dashboard y /api/deudores, que después pasan el resultado por
 * calcularDeudores y aplican cada uno su orden y su tope.
 *
 * Con `pacienteId` acota a una sola paciente sin cambiar nada más: es lo que
 * necesita recordar-cobro para saber cuánto debe la persona a la que le va a
 * avisar, y tiene que ser esta misma consulta —si la deuda que se le cuenta
 * en el SMS no es la que ve en la pantalla, el problema es peor que el bug.
 */
export async function buscarTurnosConDeuda(
  prisma: typeof db,
  organizationId: string,
  pacienteId?: string,
): Promise<TurnoConDeuda[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      organizationId,
      // La misma regla que esDeudaPendiente, expandida en el where.
      ...DEUDA_PENDIENTE,
      ...(pacienteId ? { pacienteId } : {}),
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
