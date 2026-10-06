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
// Lo que sí es de acá: el texto final del correo, la regla de que se manda
// UNO solo por corrida con todo adentro, y la de que el MISMO aviso no se
// repite cada hora (avisarSalud, abajo).

import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";

import { registrarAuditoria } from "../auditoria";
import { hashTexto } from "../auditoria-pura";

import { fuenteAuditoria } from "./auditoria-metricas";
import { fuenteTrabajos } from "./trabajos/metricas";
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
 *   - auditoría: rastros informativos perdidos → fuenteAuditoria
 *   - sesión clínica (área 2): tareas fallidas o atrasadas → fuenteTrabajos
 *   - hilo (área 4): propuestas sin resolver, integraciones atrasadas,
 *     minutos de audio del mes → `metricasHilo`
 */
export const FUENTES: ReadonlyArray<{ nombre: string; fuente: FuenteMetricas }> = [
  { nombre: "sms", fuente: metricasSms },
  { nombre: "worker", fuente: metricasWorker },
  { nombre: "entorno", fuente: metricasEntorno },
  { nombre: "trabajos", fuente: fuenteTrabajos },
  { nombre: "auditoria", fuente: fuenteAuditoria },
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

// ────────────────────────────────────────────────────────────────────────────
// No repetir el mismo aviso
//
// El cron corre cada hora. Antes mandaba el correo cada vez que algo cruzaba
// su umbral: el 29-sep fueron 24 correos idénticos en un día por dos tareas
// de un paciente de prueba, y un aviso que llega 24 veces deja de leerse.
//
// Cada aviso enviado deja constancia en eventos_auditoria (actor `sistema`,
// acción salud.aviso) con la HUELLA de su contenido: el nivel y, de cada
// métrica que cruzó, nombre, valor y texto. Si el último evento de salud de
// las últimas 24 h es un aviso con la misma huella, no se manda. Cuando una
// corrida vuelve a no tener nada que decir después de un aviso, deja
// salud.normal: corta la ventana, y si el mismo problema reaparece a las
// tres horas, avisa (es otro incidente aunque el número sea igual). Si el contenido cambió —otra
// métrica, otro número— la huella es otra y sale enseguida. Pasadas 24 h, el
// mismo aviso vuelve a salir una vez: un problema que sigue igual merece un
// recordatorio diario, no horario.
//
// No hay tabla nueva: eventos_auditoria ya es "esto pasó, cuándo y quién",
// append-only, con índice por (entidad, entidad_id). El aviso no es de
// ninguna organización: va con ORGANIZACION_SISTEMA (la columna no tiene FK).
// ────────────────────────────────────────────────────────────────────────────

export const VENTANA_AVISO_REPETIDO_MS = 24 * 60 * 60 * 1000;
/** organization_id de los eventos que no son de ningún consultorio. */
export const ORGANIZACION_SISTEMA = "sistema";
const ENTIDAD_AVISO = "salud";

/** sha256 de lo que el aviso dice, sin la hora: dos corridas con el mismo
 *  estado dan la misma huella. */
export function huellaDeAviso(salud: Pick<Salud, "nivel" | "alertas">): string {
  const alertas = salud.alertas
    .map((m) => [m.nombre, m.valor, m.texto] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return hashTexto(JSON.stringify({ nivel: salud.nivel, alertas }));
}

export interface AvisarSaludParams {
  prisma: Pick<typeof db, "eventoAuditoria">;
  salud: Salud;
  ahora: Date;
  /** Manda el correo; true si salió. La ruta le pasa src/lib/alertas.ts. */
  enviar: (salud: Salud & { nivel: NivelAlerta }) => Promise<boolean>;
}

export async function avisarSalud({
  prisma,
  salud,
  ahora,
  enviar,
}: AvisarSaludParams): Promise<{ alertaEnviada: boolean; repetida: boolean }> {
  const { nivel } = salud;
  const ultimo = await ultimoEventoDeSalud(prisma, ahora);
  if (!salud.alerta || !nivel) {
    if (ultimo?.accion === ACCIONES.salud.aviso) {
      await registrarAuditoria(prisma, {
        organizationId: ORGANIZACION_SISTEMA,
        actorTipo: "sistema",
        accion: ACCIONES.salud.normal,
        entidad: ENTIDAD_AVISO,
        entidadId: "normal",
        creadoEn: ahora,
      });
    }
    return { alertaEnviada: false, repetida: false };
  }

  const huella = huellaDeAviso(salud);
  if (ultimo?.accion === ACCIONES.salud.aviso && ultimo.entidadId === huella) {
    return { alertaEnviada: false, repetida: true };
  }

  const alertaEnviada = await enviar({ ...salud, nivel });
  // Sólo lo que salió: un correo que falló se vuelve a intentar en la
  // próxima corrida.
  if (alertaEnviada) {
    await registrarAuditoria(prisma, {
      organizationId: ORGANIZACION_SISTEMA,
      actorTipo: "sistema",
      accion: ACCIONES.salud.aviso,
      entidad: ENTIDAD_AVISO,
      entidadId: huella,
      creadoEn: ahora,
      detalle: { nivel, metricas: salud.alertas.map((m) => m.nombre) },
    });
  }
  return { alertaEnviada, repetida: false };
}

/** El último aviso o vuelta a la normalidad de las últimas 24 h. Si no se
 *  puede saber, null: se manda, porque un correo de más es mejor que un aviso
 *  perdido. */
async function ultimoEventoDeSalud(
  prisma: Pick<typeof db, "eventoAuditoria">,
  ahora: Date,
): Promise<{ accion: string; entidadId: string } | null> {
  try {
    return await prisma.eventoAuditoria.findFirst({
      where: {
        entidad: ENTIDAD_AVISO,
        accion: { in: [ACCIONES.salud.aviso, ACCIONES.salud.normal] },
        creadoEn: { gt: new Date(ahora.getTime() - VENTANA_AVISO_REPETIDO_MS), lte: ahora },
      },
      orderBy: { creadoEn: "desc" },
      select: { accion: true, entidadId: true },
    });
  } catch (error) {
    console.error("[salud] no se pudo mirar si el aviso ya salió; se manda igual", error);
    return null;
  }
}
