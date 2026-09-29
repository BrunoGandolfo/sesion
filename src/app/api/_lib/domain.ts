import type {
  Configuracion as PrismaConfiguracion,
  Paciente as PrismaPaciente,
  Prisma,
  Turno as PrismaTurno,
} from "@prisma/client";
import type {
  Configuracion,
  DeudaPaciente,
  PacienteConDeuda,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";
import {
  esDuracion,
  ESTADOS_QUE_OCUPAN,
  type Duracion,
  type EstadoTurno,
  type Modalidad,
} from "@/lib/constantes-turno";
// Solo el tipo del cliente (extendido con cifrado): este módulo no toca la
// base por sí mismo, la recibe como parámetro en buscarTurnosConDeuda.
import type { db } from "@/lib/db";
import {
  diasEnterosMvd,
  esMismoDiaMvd,
  finDeMesMvd,
  inicioDeMesMvd,
} from "@/lib/fechas-montevideo";
import { MENSAJE_NO_REABRIR, MENSAJE_SOLO_PROGRAMADOS } from "@/lib/glosario";
import { porMontoYAntiguedad } from "@/lib/orden-deuda";

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
// Cobrado en el mes — un turno cobrado cuenta en el mes de su PAGO (no el del
// turno: una sesión de abril cobrada en mayo es de mayo), en meses de
// calendario de Montevideo. Lo usan el KPI de Hoy (obtener-dashboard), la
// lista "Cobros del mes" (turnos.ts, cobrosDelMes) y Finanzas (finanzas.ts,
// que lo agrega en SQL por mes con la misma condición). Antes eran tres
// caminos escritos por separado; cobrado-del-mes.test.ts prueba que los tres
// dan el mismo número sobre la misma base.
// ────────────────────────────────────────────────────────────────────────────

/** Qué es "cobrado": el pago registrado. La fecha que cuenta es pagoFecha. */
export const COBRADO = { pagoEstado: "pagado" } as const;

/** Los turnos cobrados de la organización en el mes de `enElMesDe` (cualquier
 *  instante del mes), por la fecha del pago. */
export function cobradoEnMes(organizationId: string, enElMesDe: Date): Prisma.TurnoWhereInput {
  return {
    organizationId,
    ...COBRADO,
    pagoFecha: { gte: inicioDeMesMvd(enElMesDe), lte: finDeMesMvd(enElMesDe) },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Qué se puede hacer con un turno — la regla que aplica el servidor, escrita
// una vez para que las pantallas ofrezcan exactamente lo que el servidor
// acepta. Antes el detalle de Agenda ofrecía Cobrar a un turno programado de
// más tarde y el servidor contestaba 400; y la hoja dejaba grabar un turno de
// ayer que el servidor tampoco impedía.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Las transiciones de estado del turno, en una tabla. Antes estaban escritas
 * sueltas en cada caso de uso: la guarda del PATCH en casos-uso/turnos.ts,
 * el "cobrar un programado lo cierra" en cobrar-turno.ts y el "solo los
 * programados" de cancelar-serie-turno.ts.
 *
 *   editarDatos    PATCH que mueve, cambia duración, modalidad o notas.
 *   cambiarEstado  PATCH con `estado`: a cualquiera, salvo desde cancelado
 *                  (un turno cancelado no se reabre).
 *   cobrarCierra   Cobrar un programado cuya hora llegó lo deja realizado
 *                  en la misma sentencia (un realizado se cobra sin cambiar
 *                  de estado; ver sePuedeCobrar).
 *   cancelarSerie  "Cancelar este y los siguientes": solo los programados.
 */
export const TRANSICIONES_TURNO = {
  editarDatos: { desde: ["programado"] },
  cambiarEstado: { desde: ["programado", "realizado", "ausente"] },
  cobrarCierra: { desde: ["programado"], hacia: "realizado" },
  cancelarSerie: { desde: ["programado"], hacia: "cancelado" },
} as const satisfies Record<string, { desde: readonly EstadoTurno[]; hacia?: EstadoTurno }>;

export type TransicionTurno = keyof typeof TRANSICIONES_TURNO;

/** ¿La transición `op` sale de un turno en `estado`? */
export function puedeTransicionTurno(op: TransicionTurno, estado: string): boolean {
  return (TRANSICIONES_TURNO[op].desde as readonly string[]).includes(estado);
}

/** Un turno programado es el único que avisa: sus recordatorios siguen
 *  vivos. Cualquier otro estado los apaga (casos-uso/envios-del-turno.ts). */
export function turnoSigueProgramado(estado: string): boolean {
  return estado === "programado";
}

/**
 * Si el turno se puede cobrar en `ahora`: sin cobrar y realizado, o sin
 * cobrar y programado con la hora ya llegada (cobrarlo lo cierra, ver
 * TRANSICIONES_TURNO.cobrarCierra). Nunca cancelado, ausente ni pagado.
 *
 * Es más ancha que esDeudaPendiente: un programado cuya hora empezó se puede
 * cobrar pero todavía no es deuda.
 */
export function sePuedeCobrar(
  turno: { estado: string; pagoEstado: string; fecha: Date },
  ahora: Date,
): boolean {
  if (turno.pagoEstado !== "pendiente") return false;
  if (turno.estado === TRANSICIONES_TURNO.cobrarCierra.hacia) return true;
  return (
    puedeTransicionTurno("cobrarCierra", turno.estado) &&
    turno.fecha.getTime() <= ahora.getTime()
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editar un turno — la decisión, pura. casos-uso/turnos.ts (actualizarTurno)
// solo aplica lo que sale de acá: toma el lock, relee, pregunta, escribe.
// ────────────────────────────────────────────────────────────────────────────

/** Lo que el PATCH puede cambiar de un turno. */
export interface CambiosTurno {
  fecha?: Date;
  duracion?: Duracion;
  modalidad?: Modalidad;
  notas?: string | null;
  estado?: EstadoTurno;
}

/** Qué pasa con el recordatorio por SMS después de editar. */
export type EfectoEnvioTurno =
  /** El turno quedó cerrado (realizado, ausente, cancelado): nada avisa. */
  | "cancelar"
  /** Sigue programado y cambió la fecha: se apaga el aviso viejo y se
   *  programa el de la fecha nueva. */
  | "reprogramar"
  /** Venía cerrado y volvió a programado: el cierre apagó su aviso. */
  | "revivir"
  | null;

type TurnoEnEdicion = { estado: string; fecha: Date; duracion: number };

export type DecisionEdicionTurno =
  | { tipo: "rechazo"; mensaje: string }
  /** Un body vacío: no se escribe nada (un updateMany todo undefined
   *  devolvería count 0 y se leería como "no existe"). */
  | { tipo: "sinCambios" }
  | {
      tipo: "aplicar";
      /** El intervalo a comprobar contra la agenda, o null si esta edición
       *  no puede CREAR un solapamiento. */
      verificarSolapamiento: { inicio: Date; duracionMin: number } | null;
      efectoEnvio: EfectoEnvioTurno;
    };

function ocupaHorario(estado: string): boolean {
  return (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado);
}

/**
 * El efecto de una edición sobre el recordatorio, mirando el turno antes y
 * después de escribir. `cambioFecha` dice si el PATCH mandó `fecha`: una
 * fecha igual a la que tenía no reprograma nada.
 *
 * Es aparte de decidirEdicionTurno porque el caso de uso la vuelve a llamar
 * con la fila YA ESCRITA: cobrar no toma el lock de agenda, así que el estado
 * pudo cambiar entre la lectura y la escritura, y el aviso tiene que seguir
 * lo que quedó en la base, no lo que se previó.
 */
export function efectoEnvioDeEdicion(
  antes: { estado: string; fecha: Date },
  despues: { estado: string; fecha: Date },
  cambioFecha: boolean,
): EfectoEnvioTurno {
  if (!turnoSigueProgramado(despues.estado)) return "cancelar";
  if (cambioFecha && despues.fecha.getTime() !== antes.fecha.getTime()) return "reprogramar";
  if (!turnoSigueProgramado(antes.estado)) return "revivir";
  return null;
}

/**
 * Decide qué hacer con un PATCH sobre `actual` (la fila releída DESPUÉS del
 * lock de agenda: decidir con una lectura previa dejaría reabrir un turno
 * cancelado en el medio).
 *
 * - Cancelado y el PATCH trae `estado`: rechazo (no se reabre).
 * - Cambia datos y el turno no está programado: rechazo.
 * - Nada que cambiar: sinCambios.
 * - Si no: aplicar. El solapamiento se comprueba sólo cuando la edición
 *   puede crearlo —se movió el intervalo de un turno que ocupa, o el turno
 *   pasa de no ocupar a ocupar (ausente → programado)—; no en cada edición,
 *   o un turno que ya estaba solapado no podría ni cambiar sus notas.
 */
export function decidirEdicionTurno(
  actual: TurnoEnEdicion,
  cambios: CambiosTurno,
): DecisionEdicionTurno {
  const cambiaDatos =
    cambios.fecha !== undefined ||
    cambios.duracion !== undefined ||
    cambios.modalidad !== undefined ||
    cambios.notas !== undefined;

  if (cambios.estado !== undefined && !puedeTransicionTurno("cambiarEstado", actual.estado)) {
    return { tipo: "rechazo", mensaje: MENSAJE_NO_REABRIR };
  }
  if (cambiaDatos && !puedeTransicionTurno("editarDatos", actual.estado)) {
    return { tipo: "rechazo", mensaje: MENSAJE_SOLO_PROGRAMADOS };
  }
  if (!cambiaDatos && cambios.estado === undefined) {
    return { tipo: "sinCambios" };
  }

  const final = {
    fecha: cambios.fecha ?? actual.fecha,
    duracion: cambios.duracion ?? actual.duracion,
    estado: cambios.estado ?? actual.estado,
  };
  const movioElIntervalo =
    final.fecha.getTime() !== actual.fecha.getTime() || final.duracion !== actual.duracion;
  const pasaAOcupar = !ocupaHorario(actual.estado) && ocupaHorario(final.estado);

  return {
    tipo: "aplicar",
    verificarSolapamiento:
      ocupaHorario(final.estado) && (movioElIntervalo || pasaAOcupar)
        ? { inicio: final.fecha, duracionMin: final.duracion }
        : null,
    efectoEnvio: efectoEnvioDeEdicion(actual, final, cambios.fecha !== undefined),
  };
}

/**
 * Estados del turno en los que se puede grabar: la mitad "estado" de
 * sePuedeGrabar. La usan también las consultas que no pueden llamar a la
 * función fila por fila: el guard con lock de prepararAudio (casos-uso/
 * audio.ts) y los turnos de hoy de Pendientes (pendientes-terapeuta.ts).
 */
export const ESTADOS_GRABABLES = ["programado", "realizado"] as const;

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
  if (!(ESTADOS_GRABABLES as readonly string[]).includes(turno.estado)) {
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

export interface DeudorAgrupado {
  pacienteId: string;
  nombre: string;
  apellido: string;
  sesionesImpagas: number;
  montoTotal: number;
  minutosTotales: number;
  /** Solo presente cuando la entrada trae `fecha` (ver TurnoParaDeuda). */
  diasAtraso?: number;
  /** Fecha del impago más viejo; solo cuando la entrada trae `fecha`. Es la
   *  que da `diasAtraso` y la que desempata el orden de Hoy
   *  (lib/orden-deuda.ts): quien la necesita no la vuelve a calcular. */
  impagoMasAntiguo?: Date;
}

/**
 * Agrupa por paciente los turnos que son deuda pendiente. Devuelve cantidad,
 * monto y minutos por paciente, en EL orden de la deuda: monto descendente
 * y, a igual monto, el impago más viejo primero (lib/orden-deuda.ts; sin
 * `fecha`, a igual monto queda el orden de aparición). Es el orden de Hoy y
 * el de /api/deudores: antes esta función ordenaba sólo por monto, Hoy
 * desempataba aparte y /api/deudores ordenaba por días de atraso. Sin tope:
 * el tope lo aplica el consumidor. Un paciente sin turnos impagos no
 * aparece.
 *
 * Si los turnos traen `fecha`, cada deudor sale además con su
 * `impagoMasAntiguo` y con `diasAtraso`, calculado con diasDesde() sobre esa
 * fecha respecto de `ahora` (default: hoy). Sin `fecha` no salen ninguno de
 * los dos.
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
    if (deudor) {
      deudor.impagoMasAntiguo = fecha;
      deudor.diasAtraso = diasDesde(fecha, ahora);
    }
  }

  const masAntiguo = new Map(
    [...impagoMasAntiguo].map(([pacienteId, fecha]) => [pacienteId, fecha.toISOString()]),
  );
  return [...porPaciente.values()].sort(
    porMontoYAntiguedad((deudor) => deudor.montoTotal, masAntiguo),
  );
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
 * La deuda de UNA paciente, o null si no debe nada. La misma consulta y la
 * misma cuenta que /api/deudores y Hoy, acotadas a ella: lo que se le avisa
 * por SMS (recordar-cobro, texto-de-cobro) es lo que se ve en pantalla.
 */
export async function deudaDePaciente(
  prisma: typeof db,
  organizationId: string,
  pacienteId: string,
  ahora: Date,
): Promise<DeudorAgrupado | null> {
  const [deuda] = calcularDeudores(await buscarTurnosConDeuda(prisma, organizationId, pacienteId), ahora);
  return deuda && deuda.sesionesImpagas > 0 ? deuda : null;
}

/**
 * Query única de los turnos que son deuda pendiente de una organización
 * (DEUDA_PENDIENTE, la misma regla que esDeudaPendiente, en la consulta). La consumen
 * /api/dashboard y /api/deudores, que después pasan el resultado por
 * calcularDeudores (que da el orden) y aplican cada uno su tope.
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
