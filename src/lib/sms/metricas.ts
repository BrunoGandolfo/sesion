// Métricas de salud de los SMS, en la forma que espera el agregador
// (src/lib/salud-metricas.ts). Cuatro cosas se miran:
//
//   1. fallidos en las últimas 24 h: el sistema agotó la ventana útil sin
//      poder mandar un aviso; la profesional lo ve en el turno, pero alguien
//      tiene que saber si son muchos (Twilio, la cuenta, el número).
//   2. desconocidos: se llamó a Twilio y no se sabe si aceptó. NO se
//      reenvían solos y NO se concilian solos (decisión del dueño): quedan
//      en `desconocido` y la pantalla lo muestra. Se avisa desde 3 en 24 h,
//      porque uno suelto es un timeout y tres seguidos es un problema.
//   3. trabados en `enviando`: una corrida del cron murió con la reserva
//      tomada y el rescate no la está sacando.
//   4. segmentos aceptados en el mes, por consultorio: se CUENTA, no se
//      limita (decisión del dueño: contar sí, tope no). Informativa.

import { finDeMesMvd, inicioDeMesMvd } from "@/lib/fechas-montevideo";
import type { FuenteMetricas, MetricaSalud } from "@/lib/salud-metricas";

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 60 * MS_POR_MINUTO;

export const VENTANA_SMS_MS = 24 * MS_POR_HORA;

/** Desde cuántos fallidos en 24 h se avisa. Uno ya es una paciente sin aviso. */
export const UMBRAL_SMS_FALLIDOS = 1;

/** Desde cuántos desconocidos en 24 h se avisa. */
export const UMBRAL_SMS_DESCONOCIDOS = 3;

/** A partir de cuándo un `enviando` es una reserva abandonada. Holgadamente
 *  mayor que el rescate del despachador (5 min): si sigue ahí a los 30, el
 *  rescate tampoco la está sacando. */
export const SMS_TRABADO_MS = 30 * MS_POR_MINUTO;

export const metricasSms: FuenteMetricas = async ({ prisma, ahora }) => {
  const t = ahora.getTime();

  const [fallidos, desconocidos, trabados, porOrganizacion] = await Promise.all([
    prisma.envioSms.count({
      where: { estado: "fallido", cerradoEn: { gte: new Date(t - VENTANA_SMS_MS) } },
    }),
    prisma.envioSms.count({
      where: { estado: "desconocido", actualizadoEn: { gte: new Date(t - VENTANA_SMS_MS) } },
    }),
    prisma.envioSms.count({
      where: { estado: "enviando", actualizadoEn: { lt: new Date(t - SMS_TRABADO_MS) } },
    }),
    // Mes de MONTEVIDEO: la factura del consultorio se cierra en el
    // calendario de acá. `aceptadoEn` es cuando Twilio cobró.
    prisma.envioSms.groupBy({
      by: ["organizationId"],
      where: { aceptadoEn: { gte: inicioDeMesMvd(ahora), lte: finDeMesMvd(ahora) } },
      _sum: { segmentos: true },
    }),
  ]);

  const metricas: MetricaSalud[] = [
    {
      nombre: "sms_fallidos_24h",
      valor: fallidos,
      umbral: UMBRAL_SMS_FALLIDOS,
      nivel: "aviso",
      texto: "SMS fallidos en 24 h: se agotó la ventana útil sin poder mandarlos; el motivo está en cada turno",
    },
    {
      nombre: "sms_desconocidos_24h",
      valor: desconocidos,
      umbral: UMBRAL_SMS_DESCONOCIDOS,
      nivel: "aviso",
      texto: "SMS en estado desconocido en 24 h: se llamó a Twilio y no se sabe si aceptó; no se reenvían solos, hay que mirar la consola de Twilio",
    },
    {
      nombre: "sms_trabados_enviando",
      valor: trabados,
      umbral: 1,
      nivel: "aviso",
      texto: `SMS trabados en enviando hace más de ${SMS_TRABADO_MS / MS_POR_MINUTO} min: el rescate del cron no los está sacando`,
    },
  ];

  for (const fila of porOrganizacion) {
    metricas.push({
      nombre: `sms_segmentos_mes[${fila.organizationId}]`,
      valor: fila._sum.segmentos ?? 0,
      umbral: null,
      texto: "segmentos de SMS aceptados por Twilio en el mes (informativa)",
    });
  }

  return metricas;
};
