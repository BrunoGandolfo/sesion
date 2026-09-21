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
import { diasEnterosMvd } from "@/lib/fechas-montevideo";

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
    sesionClinica: { id: string; estado: string } | null;
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
// ficha-tab, sesiones-tab y turnos-pagos-tab.
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
