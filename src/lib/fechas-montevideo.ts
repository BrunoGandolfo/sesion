// Tiempo local de Montevideo. Una sola fuente de verdad para toda la app.
//
// POR QUÉ EXISTE
//
// El servidor corre en UTC (Vercel no deja fijar TZ: es una variable
// reservada) y el navegador corre en la zona de quien mira. Todo lo que se
// calculaba con `setHours`, `getHours` o `date-fns/format` daba, entonces,
// dos respuestas distintas según dónde se ejecutara. Dos consecuencias
// verificadas en producción el 4/9:
//
//   - una sesión de las 21:30 de Montevideo caía en "mañana" (00:30 UTC),
//     así que no aparecía en la agenda del día ni contaba como sesión de hoy;
//   - un recordatorio de un turno de las 15:15 salió diciendo "a las 18:15".
//
// La app es de un consultorio en Montevideo: "hoy", "esta semana", "este
// mes" y "a las 15:15" significan siempre lo mismo, en la hora de la
// paciente y de la profesional, corra donde corra el proceso.
//
// CÓMO
//
// Uruguay no cambia de huso desde 2015: UTC-3 todo el año, sin horario de
// verano. Con eso alcanza el desplazamiento fijo, sin base de datos de
// husos ni dependencias nuevas. El truco es siempre el mismo: se le suma el
// offset al instante para obtener un Date cuyos campos UTC son el reloj de
// pared de Montevideo, se hace la cuenta ahí, y se vuelve restándolo.
//
// date-fns se usa solo para los NOMBRES en castellano (día y mes), sobre un
// Date construido con los componentes ya resueltos: nunca para decidir qué
// día es.

import { format } from "date-fns";
import { es } from "date-fns/locale";

/** Uruguay: UTC-3 todo el año desde 2015 (sin horario de verano). */
export const OFFSET_MONTEVIDEO_MIN = -180;

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 86_400_000;
const OFFSET_MS = OFFSET_MONTEVIDEO_MIN * MS_POR_MINUTO;

/** Componentes del reloj de pared de Montevideo para un instante dado. */
export interface PartesMvd {
  anio: number;
  /** 0-11, como en Date. */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 0 = lunes … 6 = domingo. La semana del consultorio empieza el lunes. */
  diaSemana: number;
}

/** El instante, corrido para que sus campos UTC sean la hora de Montevideo. */
function pared(instante: Date): Date {
  return new Date(instante.getTime() + OFFSET_MS);
}

export function partesMvd(instante: Date): PartesMvd {
  const p = pared(instante);
  return {
    anio: p.getUTCFullYear(),
    mes: p.getUTCMonth(),
    dia: p.getUTCDate(),
    hora: p.getUTCHours(),
    minuto: p.getUTCMinutes(),
    diaSemana: (p.getUTCDay() + 6) % 7,
  };
}

/**
 * Reloj de pared de Montevideo → instante.
 *
 * `dia` puede desbordar el mes (0, -1, 32…) y `mes` el año: Date.UTC
 * normaliza, así que restar días o meses cruza el fin de mes, el año y el
 * bisiesto sin ninguna cuenta extra.
 */
export function instanteMvd(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
  ms = 0,
): Date {
  return new Date(Date.UTC(anio, mes, dia, hora, minuto, segundo, ms) - OFFSET_MS);
}

// ────────────────────────────────────────────────────────────────────────────
// Bordes del día, de la semana y del mes
// ────────────────────────────────────────────────────────────────────────────

/** 00:00:00.000 de Montevideo del día en que cae el instante. */
export function inicioDelDiaMvd(instante: Date): Date {
  const { anio, mes, dia } = partesMvd(instante);
  return instanteMvd(anio, mes, dia);
}

/** 23:59:59.999 de Montevideo del mismo día. */
export function finDelDiaMvd(instante: Date): Date {
  const { anio, mes, dia } = partesMvd(instante);
  return instanteMvd(anio, mes, dia, 23, 59, 59, 999);
}

/** Lunes 00:00 de la semana en que cae el instante. */
export function inicioDeSemanaMvd(instante: Date): Date {
  const { anio, mes, dia, diaSemana } = partesMvd(instante);
  return instanteMvd(anio, mes, dia - diaSemana);
}

/** Día 1 del mes, 00:00 de Montevideo. */
export function inicioDeMesMvd(instante: Date): Date {
  const { anio, mes } = partesMvd(instante);
  return instanteMvd(anio, mes, 1);
}

/** Último instante del mes: día 0 del mes siguiente, 23:59:59.999. */
export function finDeMesMvd(instante: Date): Date {
  const { anio, mes } = partesMvd(instante);
  return instanteMvd(anio, mes + 1, 0, 23, 59, 59, 999);
}

/**
 * Suma (o resta, con negativo) días de calendario. Con offset fijo un día
 * son siempre 24 horas exactas, así que la cuenta en milisegundos y la del
 * calendario dan lo mismo — y no depende de la zona del proceso.
 */
export function agregarDiasMvd(instante: Date, dias: number): Date {
  return new Date(instante.getTime() + dias * MS_POR_DIA);
}

// ────────────────────────────────────────────────────────────────────────────
// Comparaciones
// ────────────────────────────────────────────────────────────────────────────

/** True si los dos instantes caen en el mismo día de Montevideo. */
export function esMismoDiaMvd(a: Date, b: Date): boolean {
  return inicioDelDiaMvd(a).getTime() === inicioDelDiaMvd(b).getTime();
}

/**
 * Días de calendario enteros de `desde` a `hasta`, en Montevideo. Positivo
 * si `desde` es anterior; 0 si caen el mismo día; negativo si `desde` es
 * posterior. Cuenta días, no períodos de 24 horas: de las 23:00 de ayer a
 * la 1:00 de hoy hay un día.
 */
export function diasEnterosMvd(desde: Date, hasta: Date): number {
  const diff = inicioDelDiaMvd(hasta).getTime() - inicioDelDiaMvd(desde).getTime();
  return Math.round(diff / MS_POR_DIA);
}

/**
 * Meses de calendario enteros de `desde` a `hasta`, en Montevideo. Un mes
 * se cuenta recién cuando se pasa el mismo día del mes: del 31/1 al 28/2
 * hay 0 meses, del 31/1 al 3/3 hay 1.
 */
export function mesesEnterosMvd(desde: Date, hasta: Date): number {
  const a = partesMvd(desde);
  const b = partesMvd(hasta);
  const brutos = (b.anio - a.anio) * 12 + (b.mes - a.mes);
  if (brutos > 0 && b.dia < a.dia) return brutos - 1;
  if (brutos < 0 && b.dia > a.dia) return brutos + 1;
  return brutos;
}

// ────────────────────────────────────────────────────────────────────────────
// Lectura y formato
// ────────────────────────────────────────────────────────────────────────────

/** La hora del reloj de pared de Montevideo. */
export function horaLocalMvd(instante: Date): { hora: number; minuto: number } {
  const { hora, minuto } = partesMvd(instante);
  return { hora, minuto };
}

function dosDigitos(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "15:15". Sin date-fns: los componentes ya están resueltos. */
export function formatearHoraMvd(instante: Date): string {
  const { hora, minuto } = horaLocalMvd(instante);
  return `${dosDigitos(hora)}:${dosDigitos(minuto)}`;
}

/**
 * Date "de mentira" cuyos campos LOCALES son el reloj de pared de
 * Montevideo. Existe solo para pasárselo a date-fns, que lee campos
 * locales: así los nombres de día y mes salen bien corra donde corra el
 * proceso. Se fija el mediodía a propósito — si la zona del proceso tuviera
 * un salto de horario a medianoche, un Date a las 00:00 podría no existir y
 * el navegador lo correría a otra hora (nunca a otro día).
 */
function paraNombres(instante: Date): Date {
  const { anio, mes, dia } = partesMvd(instante);
  return new Date(anio, mes, dia, 12, 0, 0, 0);
}

/** "sábado 5 de septiembre". */
export function formatearFechaLargaMvd(instante: Date): string {
  return format(paraNombres(instante), "EEEE d 'de' MMMM", { locale: es });
}

/** "5 sep". */
export function formatearFechaCortaMvd(instante: Date): string {
  return format(paraNombres(instante), "d MMM", { locale: es });
}

/** "sábado". */
export function formatearDiaSemanaMvd(instante: Date): string {
  return format(paraNombres(instante), "EEEE", { locale: es });
}

// ────────────────────────────────────────────────────────────────────────────
// Los <input type="date"> y <input type="time"> del formulario de turnos
//
// El navegador entrega y recibe strings sin zona: "2026-09-05" y "15:15". El
// código que los armaba con getFullYear/getHours y los volvía a leer con
// `new Date("2026-09-05T15:15:00")` los interpretaba en la zona del
// dispositivo: desde un teléfono en Madrid, agendar "15:15" creaba un turno
// de las 10:15 de Montevideo, y reprogramar mostraba una hora que no era la
// del turno. Estas tres funciones son el puente, siempre en Montevideo.
// ────────────────────────────────────────────────────────────────────────────

/** "2026-09-05": el día de Montevideo del instante, como lo quiere un
 *  <input type="date">. */
export function fechaInputMvd(instante: Date): string {
  const { anio, mes, dia } = partesMvd(instante);
  return `${anio}-${dosDigitos(mes + 1)}-${dosDigitos(dia)}`;
}

/** "15:15": la hora de Montevideo del instante, como la quiere un
 *  <input type="time">. Es el mismo texto que formatearHoraMvd; se nombra
 *  aparte porque quien llena un input no está formateando para leer. */
export function horaInputMvd(instante: Date): string {
  return formatearHoraMvd(instante);
}

/**
 * "2026-09-05" + "15:15" → el instante en que eso pasa en Montevideo.
 *
 * Acepta "15:15" y "15:15:30" (los inputs con `step` mandan segundos). Si
 * alguno de los dos no tiene la forma esperada devuelve un Date inválido, que
 * es lo mismo que hacía `new Date(...)` con un string roto: quien llama ya
 * valida con zod antes de llegar acá.
 */
export function instanteDesdeFechaHoraMvd(fecha: string, hora: string): Date {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
  if (!f || !h) return new Date(NaN);
  return instanteMvd(
    Number(f[1]),
    Number(f[2]) - 1,
    Number(f[3]),
    Number(h[1]),
    Number(h[2]),
    h[3] ? Number(h[3]) : 0,
  );
}

/** Los dos bordes del día de Montevideo en que cae el instante. El rango que
 *  pide la agenda cuando se mira un solo día. */
export function inicioFinDiaMvd(instante: Date): { desde: Date; hasta: Date } {
  return { desde: inicioDelDiaMvd(instante), hasta: finDelDiaMvd(instante) };
}
