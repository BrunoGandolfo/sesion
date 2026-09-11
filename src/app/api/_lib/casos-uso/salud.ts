// Caso de uso: juntar las métricas de salud de todas las áreas, compararlas
// con su umbral y decidir qué se avisa.
//
// Este archivo es un AGREGADOR y nada más. Antes sabía de sesiones, de
// recordatorios, del hilo y del gasto de audio: seis métricas de cuatro áreas
// en un solo lugar donde todas se pisaban. Ahora cada área exporta una fuente
// con la forma de src/lib/salud-metricas.ts (nombre, valor, umbral, texto,
// nivel) y acá sólo se listan. Agregar una métrica es agregar una fuente a
// FUENTES; el texto y el umbral los decide quien conoce el dominio.
//
// Una fuente que LANZA no tumba al resto: se convierte en una alerta propia
// ("la fuente X falló"), porque una métrica que no se pudo calcular no es un
// 0, es una métrica ciega.
//
// Lo que sí es de acá: el texto final del correo y la regla de que se manda
// UNO solo por corrida con todo adentro.

import { validarEnvOperacion } from "@/lib/env-operacion";
import {
  cruzaUmbral,
  lineasDeAlerta,
  metricasWorker,
  nivelMaximo,
  type ContextoMetricas,
  type FuenteMetricas,
  type MetricaSalud,
  type NivelAlerta,
} from "@/lib/salud-metricas";
import { metricasSms } from "@/lib/sms/metricas";

/** Variables de operación que faltan. Crítica: sin ellas no hay alertas o
 *  no hay SMS. Cuenta también en desarrollo (informa), alerta en producción. */
export const metricasEntorno: FuenteMetricas = async () => {
  const { faltantes, produccion } = validarEnvOperacion();
  return [
    {
      nombre: "entorno_variables_faltantes",
      valor: faltantes.length,
      umbral: produccion ? 1 : null,
      nivel: "critico",
      texto: `variables de operación faltantes (${faltantes.join(", ") || "ninguna"}): ver docs/operaciones.md §2`,
    },
  ];
};

/**
 * Las fuentes, una por área. Cada área agrega la suya acá (una línea) y
 * define la métrica en su propio módulo:
 *
 *   - operación (área 5): metricasSms, metricasWorker, metricasEntorno
 *   - sesión clínica (área 2): sesiones trabadas en procesando, trabajos
 *     fallidos → exportar `metricasSesiones` y sumarla acá
 *   - hilo (área 4): propuestas sin resolver, integraciones atrasadas,
 *     minutos de audio del mes → `metricasHilo`
 */
export const FUENTES: ReadonlyArray<{ nombre: string; fuente: FuenteMetricas }> = [
  { nombre: "sms", fuente: metricasSms },
  { nombre: "worker", fuente: metricasWorker },
  { nombre: "entorno", fuente: metricasEntorno },
];

export interface Salud {
  /** Todas las métricas, crucen o no: para mirar la curva. */
  metricas: MetricaSalud[];
  /** Las que cruzaron su umbral. */
  alertas: MetricaSalud[];
  nivel: NivelAlerta | null;
  /** Texto a mandar, o null si no hay nada que avisar. */
  alerta: string | null;
}

export interface RevisarSaludParams extends ContextoMetricas {
  /** Para tests: reemplaza la lista de fuentes. */
  fuentes?: ReadonlyArray<{ nombre: string; fuente: FuenteMetricas }>;
}

export async function revisarSalud({
  prisma,
  ahora,
  fuentes = FUENTES,
}: RevisarSaludParams): Promise<Salud> {
  const resultados = await Promise.allSettled(
    fuentes.map(({ fuente }) => fuente({ prisma, ahora })),
  );

  const metricas: MetricaSalud[] = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      metricas.push(...r.value);
      return;
    }
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    metricas.push({
      nombre: `fuente_fallida[${fuentes[i].nombre}]`,
      valor: 1,
      umbral: 1,
      nivel: "critico",
      texto: `fuente de métricas "${fuentes[i].nombre}" falló al consultar: ${msg.slice(0, 200)}`,
    });
  });

  const alertas = metricas.filter(cruzaUmbral);
  if (alertas.length === 0) {
    return { metricas, alertas, nivel: null, alerta: null };
  }

  return {
    metricas,
    alertas,
    nivel: nivelMaximo(alertas),
    alerta: `Sesión: ${lineasDeAlerta(alertas).join("; ")}`,
  };
}
