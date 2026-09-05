// Caso de uso: revisar la salud del pipeline y decidir si hay que avisar.
//
// Vivía adentro de src/app/api/cron/salud/route.ts. Se separó porque un
// archivo de ruta no se puede testear sin levantar la ruta —Next valida qué
// se puede exportar de un route handler, así que ni los umbrales se pueden
// sacar afuera para mirarlos— y esta tanda agrega dos decisiones que sí hay
// que poder probar: la métrica de recordatorios trabados y el aviso propio
// de la métrica saturada. La ruta se queda con lo suyo: autenticar el cron,
// mandar el webhook y contestar.
//
// QUÉ SE MIRA
//
//   1. sesiones trabadas en "procesando" (el worker no contestó);
//   2. recordatorios fallidos en las últimas 24 h (Twilio o el número);
//   3. recordatorios trabados en "enviando" (una corrida del cron de envío
//      que se murió con la reserva tomada y que el rescate no está sacando);
//   4. sesiones aprobadas hace rato que el Golden Thread no integró (la
//      Llamada B del worker dejó de correr);
//   5. minutos de audio transcriptos en el mes corriente, contra un techo
//      explícito (control de gasto).
//
// La 4 es la más silenciosa: la nota está aprobada, el audio ya se borró y la
// app se ve perfecta; lo único que pasa es que el hilo del proceso —lo que
// ella lee antes de la próxima sesión— se quedó viejo.
//
// Y hay un aviso más que no es una cuenta sino una advertencia SOBRE las
// cuentas. La métrica 4 mira como mucho TOPE_ATRASADAS filas, las más viejas
// primero. Cuando se llega a ese tope, `cantidad` es un piso: si esas 200
// resultan estar integradas, contesta 0 aunque haya una sesión más nueva
// trabada, y el umbral de "avisar con 1 o más" nunca se cruza. Por eso la
// saturación alerta por sí sola, con texto propio: la respuesta no es "mirá
// esas N sesiones", es "esta métrica dejó de servir, mirá la base a mano".

import type { db } from "@/lib/db";
import { finDeMesMvd, inicioDeMesMvd } from "@/lib/fechas-montevideo";

import { RESCATE_MS } from "./enviar-recordatorios";
import {
  contarSesionesSinContextoAtrasadas,
  TOPE_ATRASADAS,
} from "./sesiones-sin-contexto";

type ClientePrisma = typeof db;

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 60 * MS_POR_MINUTO;

// ────────────────────────────────────────────────────────────────────────────
// Umbrales y ventanas. Explícitos: subir uno es cambiar un número, no una
// comparación.
// ────────────────────────────────────────────────────────────────────────────

/** Cuánto puede estar una sesión en "procesando" antes de ser un problema. */
export const RETRASO_PROCESANDO_MS = 2 * MS_POR_HORA;

/** Ventana en la que se cuentan los recordatorios fallidos. */
export const VENTANA_FALLIDOS_MS = 24 * MS_POR_HORA;

/**
 * A partir de cuándo un recordatorio en "enviando" deja de ser una corrida en
 * curso y pasa a ser una reserva abandonada.
 *
 * RESCATE_MS (5 min) es lo que espera el despachador para retomar una reserva
 * huérfana. Una fila que sigue trabada 30 minutos después ya sobrevivió a
 * varios ticks del cron de envío: el problema no es que nadie la haya
 * intentado, es que el rescate tampoco la está sacando. Se escribe como
 * múltiplo de RESCATE_MS para que bajar el lease no deje este umbral
 * apuntando a un número que ya no significa nada.
 */
export const MULTIPLO_RESCATE_TRABADO = 6;
export const RECORDATORIO_TRABADO_MS = MULTIPLO_RESCATE_TRABADO * RESCATE_MS;

/** Cuánto puede tardar la integración al hilo antes de considerarse atrasada.
 *  El worker la hace enseguida de aprobar; un día es holgura, no expectativa. */
export const RETRASO_CONTEXTO_MS = 24 * MS_POR_HORA;

/** Desde cuántos casos cada métrica deja de ser ruido y pasa a ser aviso. */
export const UMBRAL_SESIONES_TRABADAS = 1;
export const UMBRAL_RECORDATORIOS_FALLIDOS = 1;
export const UMBRAL_RECORDATORIOS_TRABADOS = 1;
export const UMBRAL_SIN_CONTEXTO = 1;

// ────────────────────────────────────────────────────────────────────────────
// Control de gasto
//
// El pipeline cobra por minuto de audio transcripto (ASR) y por token de
// entrada/salida (LLM). Nada de eso se estaba mirando: una sesión que se
// reprocesa en bucle, un audio de tres horas subido por error o un worker
// atascado reintentando gastan plata en silencio hasta que llega la factura.
//
// LO QUE SE PUEDE MEDIR HOY Y LO QUE NO
//
// Los minutos de audio SÍ: `SesionClinica.duracionAudioSeg` existe y lo
// escribe upload-confirmar. Los tokens NO: no hay columna donde guardarlos y
// el worker tampoco los manda (el payload de /api/sesion-clinica/callback
// acepta modeloASR, modeloLLM y promptVersion, y nada más). Las dos cosas
// están BLOQUEADAS en el reporte del PR con el SQL propuesto; hasta que
// existan, esta métrica cubre la mitad que se puede cubrir, que además es la
// que crece más rápido con un bucle de reprocesamiento.
//
// QUÉ SE CUENTA
//
// La suma de `duracionAudioSeg` de las sesiones con `procesadoEn` dentro del
// mes corriente de Montevideo. `procesadoEn` es cuando el worker terminó, o
// sea cuando el proveedor efectivamente cobró.
//
// SUBESTIMA, y hay que decirlo: una sesión que el worker empezó a transcribir
// y murió antes de contestar ya se pagó y no tiene `procesadoEn`, así que no
// entra. Contar eso exacto necesita las columnas de la BLOQUEADA. Para lo que
// esta métrica existe —darse cuenta de que el gasto se disparó— alcanza: un
// bucle de reprocesamiento sí deja `procesadoEn` en cada vuelta.
// ────────────────────────────────────────────────────────────────────────────

const SEGUNDOS_POR_MINUTO = 60;

/**
 * Techo mensual de minutos de audio transcriptos, explícito.
 *
 * De dónde sale el número: el consultorio es de una profesional. Un mes
 * cargado son ~40 sesiones de 50 minutos, unos 2.000 minutos. 3.000 (50
 * horas) deja holgura para un mes excepcional y sigue siendo inequívoco: si
 * se cruza, o el consultorio cambió de tamaño o algo está reprocesando.
 *
 * Es un umbral de AVISO, no un corte: nada se bloquea al pasarlo. Cortar el
 * pipeline por gasto en una app clínica es peor que la factura.
 */
export const TOPE_MINUTOS_AUDIO_MES = 3_000;

export interface RevisarSaludParams {
  prisma: ClientePrisma;
  /** Momento de la corrida. Se inyecta para que el caso de uso sea
   *  determinista y los tests no dependan del reloj. */
  ahora: Date;
}

export interface Salud {
  sesionesTrabadas: number;
  recordatoriosFallidos: number;
  /** Recordatorios en "enviando" desde hace más de RECORDATORIO_TRABADO_MS. */
  recordatoriosTrabados: number;
  sesionesSinContexto: number;
  /** true si la métrica anterior llegó al tope: es un piso, no el total. */
  sesionesSinContextoSaturado: boolean;
  /** Minutos de audio transcriptos en el mes corriente de Montevideo.
   *  Redondeado hacia arriba: medio minuto de audio se paga entero. */
  minutosAudioDelMes: number;
  /** Techo con el que se compara, para que quien lea la respuesta no tenga
   *  que ir a buscar la constante. */
  topeMinutosAudioMes: number;
  /** Texto a mandar, o null si no hay nada que avisar. */
  alerta: string | null;
}

export async function revisarSalud({
  prisma,
  ahora,
}: RevisarSaludParams): Promise<Salud> {
  const t = ahora.getTime();

  const [
    sesionesTrabadas,
    recordatoriosFallidos,
    recordatoriosTrabados,
    sinContexto,
    audioDelMes,
  ] = await Promise.all([
    prisma.sesionClinica.count({
      where: {
        estado: "procesando",
        updatedAt: { lt: new Date(t - RETRASO_PROCESANDO_MS) },
      },
    }),
    prisma.recordatorio.count({
      where: {
        estado: "fallido",
        actualizadoEn: { gte: new Date(t - VENTANA_FALLIDOS_MS) },
      },
    }),
    prisma.recordatorio.count({
      where: {
        estado: "enviando",
        actualizadoEn: { lt: new Date(t - RECORDATORIO_TRABADO_MS) },
      },
    }),
    contarSesionesSinContextoAtrasadas({
      prisma,
      hasta: new Date(t - RETRASO_CONTEXTO_MS),
    }),
    // Mes de MONTEVIDEO, no del servidor (que corre en UTC): la factura del
    // consultorio se cierra en el calendario de acá. Los bordes salen de
    // fechas-montevideo.ts, la única fuente de verdad del huso.
    prisma.sesionClinica.aggregate({
      _sum: { duracionAudioSeg: true },
      where: {
        procesadoEn: {
          gte: inicioDeMesMvd(ahora),
          lte: finDeMesMvd(ahora),
        },
      },
    }),
  ]);

  const minutosAudioDelMes = Math.ceil(
    (audioDelMes._sum.duracionAudioSeg ?? 0) / SEGUNDOS_POR_MINUTO,
  );

  const motivos: string[] = [];

  if (sesionesTrabadas >= UMBRAL_SESIONES_TRABADAS) {
    motivos.push(
      `${sesionesTrabadas} sesiones en procesando hace más de 2 h`,
    );
  }

  if (recordatoriosFallidos >= UMBRAL_RECORDATORIOS_FALLIDOS) {
    motivos.push(`${recordatoriosFallidos} recordatorios fallidos en 24 h`);
  }

  if (recordatoriosTrabados >= UMBRAL_RECORDATORIOS_TRABADOS) {
    motivos.push(
      `${recordatoriosTrabados} recordatorios trabados en enviando hace más de ` +
        `${RECORDATORIO_TRABADO_MS / MS_POR_MINUTO} min`,
    );
  }

  if (sinContexto.cantidad >= UMBRAL_SIN_CONTEXTO) {
    motivos.push(
      `${sinContexto.cantidad} sesiones aprobadas hace más de 24 h sin integrar al hilo`,
    );
  }

  // Aviso propio: no cuenta casos, avisa que la cuenta de arriba dejó de ser
  // confiable. Dispara aunque `cantidad` sea 0 — que es justamente el caso
  // que se estaba perdiendo.
  if (sinContexto.saturado) {
    motivos.push(
      `la revisión de sesiones sin integrar llegó al tope de ${TOPE_ATRASADAS} filas: ` +
        `el número de arriba es un piso y puede estar tapando una sesión más nueva, ` +
        `hay que mirar la base a mano`,
    );
  }

  if (minutosAudioDelMes > TOPE_MINUTOS_AUDIO_MES) {
    motivos.push(
      `${minutosAudioDelMes} minutos de audio transcriptos en el mes, por encima del tope de ` +
        `${TOPE_MINUTOS_AUDIO_MES}: revisá si hay sesiones reprocesándose`,
    );
  }

  return {
    sesionesTrabadas,
    recordatoriosFallidos,
    recordatoriosTrabados,
    sesionesSinContexto: sinContexto.cantidad,
    sesionesSinContextoSaturado: sinContexto.saturado,
    minutosAudioDelMes,
    topeMinutosAudioMes: TOPE_MINUTOS_AUDIO_MES,
    alerta: motivos.length > 0 ? `Sesión: ${motivos.join("; ")}` : null,
  };
}
