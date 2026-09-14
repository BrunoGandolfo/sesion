// La forma en que cada área le cuenta al cron de salud cómo está lo suyo.
//
// POR QUÉ UNA INTERFAZ Y NO UN ARCHIVO QUE SABE DE TODO
//
// `revisarSalud` miraba seis métricas y cinco eran de otras áreas: sesiones
// trabadas (área 2), sesiones sin integrar al hilo (área 4), minutos de audio
// (área 4)… Quien conoce el dominio es quien puede decir qué es "trabado" y
// desde cuántos casos importa. El área de operación es dueña del CANAL (el
// correo) y del ritmo (el cron cada hora), no de cada umbral.
//
// Entonces: cada área exporta una FUENTE —una función que recibe el cliente
// Prisma y el instante, y devuelve una lista de métricas con su umbral y su
// texto— y src/app/api/_lib/casos-uso/salud.ts las junta, las compara y
// manda un solo correo. Agregar una métrica es agregar una fuente a la lista
// FUENTES de ese archivo; ninguna otra área toca la de las demás.
//
// CÓMO SE ESCRIBE UNA FUENTE (contrato para las otras áreas)
//
//   import type { FuenteMetricas } from "@/lib/salud-metricas";
//
//   export const metricasSesiones: FuenteMetricas = async ({ prisma, ahora }) => [
//     {
//       nombre: "sesiones_procesando_mas_de_2h",
//       valor: await prisma.sesionClinica.count({ where: { … } }),
//       umbral: 1,
//       nivel: "aviso",
//       texto: "sesiones en procesando hace más de 2 h: el worker no contestó",
//     },
//   ];
//
//   - `nombre`: estable y en snake_case; es lo que se ve en la respuesta del
//     cron y lo que se grafica si algún día hay un tablero.
//   - `valor`: siempre un número. Si la métrica no se pudo calcular, que la
//     fuente lance: el agregador lo convierte en una alerta propia
//     ("la fuente X falló") en vez de reportar un 0 que parece sano.
//   - `umbral`: se avisa cuando `valor >= umbral`. `null` = informativa:
//     viaja en la respuesta para poder mirar la curva, nunca alerta.
//   - `texto`: en castellano, sin el número adelante (lo pone el agregador),
//     y con la ACCIÓN cuando la hay ("hay que avisarles"): es lo que lee una
//     persona a las 3 de la mañana.
//   - `nivel`: "critico" cuando hay que levantarse (la base no responde, el
//     worker está muerto, nadie puede mandar SMS); "aviso" para lo demás.
//     Default: "aviso".
//   - Nada de texto clínico, nombres ni teléfonos en `texto`: el correo sale
//     del sistema y viaja por un proveedor.

import type { db } from "@/lib/db";

export type NivelAlerta = "critico" | "aviso";

export interface MetricaSalud {
  nombre: string;
  valor: number;
  umbral: number | null;
  texto: string;
  nivel?: NivelAlerta;
}

export interface ContextoMetricas {
  /** El cliente Prisma extendido (el `db` de la app, o el de test). */
  prisma: typeof db;
  /** Momento de la corrida. Se inyecta para que las fuentes sean deterministas. */
  ahora: Date;
}

export type FuenteMetricas = (ctx: ContextoMetricas) => Promise<MetricaSalud[]>;

/** True si la métrica cruzó su umbral. Una informativa (umbral null) nunca. */
export function cruzaUmbral(m: MetricaSalud): boolean {
  return m.umbral !== null && Number.isFinite(m.valor) && m.valor >= m.umbral;
}

/** El nivel más alto entre las métricas que cruzaron. */
export function nivelMaximo(metricas: MetricaSalud[]): NivelAlerta {
  return metricas.some((m) => m.nivel === "critico") ? "critico" : "aviso";
}

/** Una línea por métrica cruzada: "<valor> <texto>". */
export function lineasDeAlerta(metricas: MetricaSalud[]): string[] {
  return metricas.map((m) => `${m.valor} ${m.texto}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Latido del worker
//
// El worker no manda un latido aparte: la app actualiza la fila única de
// worker_estado en cada GET /api/sesion-clinica/pendientes (la escribe el
// área 2). Acá sólo se LEE y se decide si está vivo. Un worker ocioso hace
// poll igual, así que "sin poll en N minutos" es "muerto" y no "sin trabajo".
// ────────────────────────────────────────────────────────────────────────────

/** Sin poll en más de esto, el worker está caído. El poll normal es cada
 *  pocos segundos; diez minutos absorben un redeploy de Railway. */
export const LATIDO_MAXIMO_SEG = 600;

/** Valor que toma la métrica cuando nunca hubo un poll: no hay edad que
 *  medir, pero tiene que cruzar el umbral igual. */
export const LATIDO_NUNCA = Number.MAX_SAFE_INTEGER;

export interface EstadoWorker {
  vivo: boolean;
  /** null si nunca hubo poll. */
  ultimoPollEn: Date | null;
  edadSegundos: number | null;
  version: string | null;
}

/** Decisión pura a partir de la fila de worker_estado (o su ausencia). */
export function estadoDelWorker(
  fila: { ultimoPollEn: Date; version: string } | null,
  ahora: Date,
  maximoSeg: number = LATIDO_MAXIMO_SEG,
): EstadoWorker {
  if (!fila) {
    return { vivo: false, ultimoPollEn: null, edadSegundos: null, version: null };
  }
  const edadSegundos = Math.max(
    0,
    Math.floor((ahora.getTime() - fila.ultimoPollEn.getTime()) / 1000),
  );
  return {
    vivo: edadSegundos <= maximoSeg,
    ultimoPollEn: fila.ultimoPollEn,
    edadSegundos,
    version: fila.version,
  };
}

/** Fuente de métricas del latido, para el agregador. */
export const metricasWorker: FuenteMetricas = async ({ prisma, ahora }) => {
  const fila = await prisma.workerEstado.findUnique({
    where: { id: "worker" },
    select: { ultimoPollEn: true, version: true },
  });
  const estado = estadoDelWorker(fila, ahora);
  return [
    {
      nombre: "worker_segundos_sin_poll",
      valor: estado.edadSegundos ?? LATIDO_NUNCA,
      umbral: LATIDO_MAXIMO_SEG + 1,
      nivel: "critico",
      texto:
        estado.edadSegundos === null
          ? "segundos sin poll del worker: NUNCA hizo uno; las sesiones no se van a procesar"
          : `segundos sin poll del worker (máximo ${LATIDO_MAXIMO_SEG}): está caído, las sesiones no se van a procesar`,
    },
  ];
};
