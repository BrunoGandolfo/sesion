// Caso de uso: el resumen de Finanzas.
//
// Para quién es: una psicóloga que cobra por sesión, en pesos uruguayos y sin
// centavos, y que no tiene formación contable. Todo lo que sale de acá está
// en pesos ENTEROS y ya calculado: la pantalla dibuja, no hace cuentas.
//
// ─── LAS DOS PLATAS, QUE NO SON LA MISMA ────────────────────────────────────
//
// La confusión que este archivo existe para evitar:
//
//   COBRADO    plata que ENTRÓ. Turnos con el pago hecho, contados en el mes
//              de la FECHA DE PAGO (pago_fecha), pase lo que pase con el
//              turno. Es lo que dice el banco.
//   TRABAJADO  valor del trabajo HECHO. Turnos en estado `realizado`,
//              contados en el mes de la FECHA DE LA SESIÓN (fecha), estén
//              cobrados o no. Es lo que dice la agenda.
//
// Una sesión dada en agosto y cobrada en septiembre suma a TRABAJADO de
// agosto y a COBRADO de septiembre. Los dos números son correctos y son
// distintos: por eso viajan separados y con esos nombres.
//
// De lo TRABAJADO en el período, la parte ya cobrada (cuando sea que se haya
// cobrado) es `trabajadoCobrado`, y lo que falta es `trabajadoSinCobrar`. Esa
// es la única división que se puede leer como "de cada diez sesiones que
// diste, cobraste nueve": las dos puntas miran el mismo conjunto de sesiones.
// Cruzar `sesionesCobradas` (eje del pago) con `sesionesRealizadas` (eje del
// trabajo) da números mayores a diez sobre diez y no significa nada.
//
// ─── EL MES ES EL DE MONTEVIDEO ─────────────────────────────────────────────
//
// Las columnas de fecha son `timestamp` sin zona y el proceso corre en UTC.
// Una sesión del 31 a las 23:30 de Montevideo es 02:30 UTC del día 1: sin
// corregir caería en el mes siguiente. Acá el corrimiento se aplica DENTRO de
// la consulta, con el mismo offset que usa toda la app
// (OFFSET_MONTEVIDEO_MIN), y los bordes del rango entran como literales
// `::timestamp`, sin zona, para que el resultado no dependa de la zona de la
// sesión de Postgres (ver conectarBaseDeTest y el incidente del 19/9).
//
// ─── CUÁNTAS CONSULTAS ──────────────────────────────────────────────────────
//
// Cuatro, y ninguna por mes. Diez años son cuatro consultas igual que un mes:
//
//   1. eje TRABAJO, agregado por mes (realizadas, ausencias, canceladas…);
//   2. eje PAGO, agregado por mes y método de pago;
//   3. pacientes distintas, agregadas por el período que se pidió y con el
//      total del período en la misma pasada (GROUPING SETS): un conteo de
//      distintas NO se puede sumar entre meses;
//   4. el primer turno y el primer pago de la organización.
//
// Las dos primeras se piden sobre un rango ENSANCHADO —el período pedido más
// las dos ventanas de comparación— y las comparaciones salen de sumar esos
// mismos meses en memoria. Por eso las comparaciones no cuestan consultas.
//
// La deuda de hoy NO se agrega en SQL: sale de buscarTurnosConDeuda, la misma
// lectura que /api/deudores, para que los dos números cierren por
// construcción y no por casualidad.

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { METODOS_PAGO } from "@/lib/constantes-turno";
import type { db } from "@/lib/db";
import { OFFSET_MONTEVIDEO_MIN } from "@/lib/fechas-montevideo";

import {
  buscarTurnosConDeuda,
  deudaPorAntiguedad,
  TRAMOS_DEUDA,
} from "../domain";
import {
  correrMeses,
  finDeMes,
  formatearMes,
  inicioDeMes,
  largoEnMeses,
  mesDe,
  parsearMes,
  type MesMvd,
} from "../periodo";
import { ApiError } from "../responses";

export { correrMeses, formatearMes, largoEnMeses, mesDe, parsearMes };
export type { MesMvd };

type ClientePrisma = typeof db;

/** Los métodos que puede traer un cobro, más el que no declaró ninguno. */
export const METODOS_COBRO = [...METODOS_PAGO, "sin_metodo"] as const;
export type MetodoCobro = (typeof METODOS_COBRO)[number];

// ────────────────────────────────────────────────────────────────────────────
// El período: siempre meses enteros de Montevideo. El parser y la aritmética
// viven en _lib/periodo.ts, compartidos con el historial clínico: un solo
// lugar decide qué significa "2026-09".
// ────────────────────────────────────────────────────────────────────────────

const inicioDe = inicioDeMes;
const finDe = finDeMes;

/**
 * Literal SQL sin zona para un instante. Las columnas son `timestamp WITHOUT
 * time zone` y guardan el instante en UTC; si el borde entrara como un valor
 * CON zona, Postgres lo movería a la zona de la sesión y el rango se correría
 * tres horas. Esto lo deja explícito y atado a nada.
 */
const sinZona = (instante: Date) => instante.toISOString().replace("Z", "");

/** La fecha de la columna, corrida al reloj de pared de Montevideo. */
const enMontevideo = (columna: string) =>
  Prisma.sql`${Prisma.raw(`t."${columna}"`)} + (interval '1 minute' * ${OFFSET_MONTEVIDEO_MIN})`;

// ────────────────────────────────────────────────────────────────────────────
// Contrato de respuesta
// ────────────────────────────────────────────────────────────────────────────

export const GRANULARIDADES = ["mes", "anio"] as const;
export type Granularidad = (typeof GRANULARIDADES)[number];

/** Hasta acá se agrupa por mes; pasado esto, por año. Dos años de barras
 *  mensuales entran en una pantalla de teléfono; tres ya no se leen. */
export const MAX_MESES_POR_MES = 24;

/** Tope duro del rango pedido. No es una regla de producto: es para que un
 *  parámetro absurdo no dispare un barrido de siglos. */
export const MAX_MESES_RANGO = 600;

const entero = z.number().int();
const monto = entero.nonnegative();

const cobradoPorMetodoSchema = z.object({
  metodo: z.enum(METODOS_COBRO),
  sesiones: entero.nonnegative(),
  monto,
});

const periodoSchema = z.object({
  /** "2026-09" si la granularidad es mes; "2026" si es año. */
  clave: z.string().min(4),
  anio: entero,
  /** 1-12 con granularidad mes; null con granularidad año. */
  mes: entero.min(1).max(12).nullable(),
  cobrado: monto,
  sesionesCobradas: entero.nonnegative(),
  trabajado: monto,
  sesionesRealizadas: entero.nonnegative(),
  trabajadoCobrado: monto,
  sesionesRealizadasCobradas: entero.nonnegative(),
  trabajadoSinCobrar: monto,
  sesionesRealizadasSinCobrar: entero.nonnegative(),
  ausencias: entero.nonnegative(),
  ausenciasMonto: monto,
  canceladas: entero.nonnegative(),
  pacientesDistintas: entero.nonnegative(),
  /** Pesos enteros; null si no hubo sesiones realizadas. */
  tarifaPromedio: monto.nullable(),
  cobradoPorMetodo: z.array(cobradoPorMetodoSchema),
});

const comparacionSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  cobrado: monto,
  trabajado: monto,
  sesionesRealizadas: entero.nonnegative(),
  /** Diferencia contra el período pedido (positivo = el pedido fue mayor). */
  variacionCobrado: entero,
  variacionTrabajado: entero,
  variacionSesionesRealizadas: entero,
  /** Variación en puntos porcentuales enteros; null si la base era cero. */
  porcentajeCobrado: entero.nullable(),
  porcentajeTrabajado: entero.nullable(),
});

const proporcionSchema = z.object({
  /** "de cada diez sesiones que diste, cobraste N". null sin sesiones. */
  deCadaDiez: entero.min(0).max(10).nullable(),
  porcentaje: entero.min(0).max(100).nullable(),
  sesionesRealizadas: entero.nonnegative(),
  sesionesRealizadasCobradas: entero.nonnegative(),
});

const tramoDeudaSchema = z.object({
  tramo: z.enum(TRAMOS_DEUDA),
  sesiones: entero.nonnegative(),
  monto,
  pacientes: entero.nonnegative(),
});

export const resumenFinanzasSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  granularidad: z.enum(GRANULARIDADES),
  /** Si la eligió el servidor porque no vino en el pedido. */
  granularidadAutomatica: z.boolean(),
  serie: z.array(periodoSchema),
  totales: periodoSchema.omit({ clave: true, anio: true, mes: true }),
  comparaciones: z.object({
    periodoAnterior: comparacionSchema.nullable(),
    mismoPeriodoAnioAnterior: comparacionSchema.nullable(),
  }),
  proporcionCobrada: proporcionSchema,
  deudaHoy: z.object({
    alDia: z.string(),
    sesiones: entero.nonnegative(),
    monto,
    tramos: z.array(tramoDeudaSchema),
  }),
  /** "2019-03", o null si la organización no tiene un solo turno. */
  primerMesConDatos: z.string().nullable(),
});

export type ResumenFinanzas = z.infer<typeof resumenFinanzasSchema>;
export type PeriodoFinanzas = z.infer<typeof periodoSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Las filas crudas de las dos consultas agregadas
// ────────────────────────────────────────────────────────────────────────────

interface FilaTrabajo {
  anio: number;
  mes: number;
  realizadas: number;
  trabajado: bigint;
  realizadas_cobradas: number;
  trabajado_cobrado: bigint;
  ausencias: number;
  ausencias_monto: bigint;
  canceladas: number;
}

interface FilaPago {
  anio: number;
  mes: number;
  metodo: string | null;
  sesiones: number;
  monto: bigint;
}

interface FilaPacientes {
  anio: number | null;
  mes: number | null;
  pacientes: number;
}

const n = (v: bigint | number | null) => Number(v ?? 0);

// ────────────────────────────────────────────────────────────────────────────
// El caso de uso
// ────────────────────────────────────────────────────────────────────────────

export interface ResumenFinanzasInput {
  prisma: ClientePrisma;
  organizationId: string;
  /** Primer mes del período. Por defecto, once meses antes de `hasta`. */
  desde?: MesMvd;
  /** Último mes del período. Por defecto, el mes de `ahora`. */
  hasta?: MesMvd;
  /** Sin esto la elige el servidor por el largo del período. */
  granularidad?: Granularidad;
  ahora?: Date;
}

export async function resumenFinanzas({
  prisma,
  organizationId,
  desde: desdePedido,
  hasta: hastaPedido,
  granularidad: granularidadPedida,
  ahora = new Date(),
}: ResumenFinanzasInput): Promise<ResumenFinanzas> {
  const hasta = hastaPedido ?? mesDe(ahora);
  const desde = desdePedido ?? correrMeses(hasta, -11);

  const meses = largoEnMeses(desde, hasta);
  if (meses <= 0) {
    throw new ApiError("El período termina antes de empezar", 400);
  }
  if (meses > MAX_MESES_RANGO) {
    throw new ApiError(
      `El período no puede pasar de ${MAX_MESES_RANGO} meses`,
      400,
    );
  }

  const granularidad =
    granularidadPedida ?? (meses <= MAX_MESES_POR_MES ? "mes" : "anio");
  const porMes = granularidad === "mes";

  // Las dos ventanas de comparación, en meses enteros.
  const anterior = {
    desde: correrMeses(desde, -meses),
    hasta: correrMeses(desde, -1),
  };
  const anioAnterior = {
    desde: correrMeses(desde, -12),
    hasta: correrMeses(hasta, -12),
  };

  // Un solo rango para las dos consultas de serie: el pedido más las dos
  // ventanas. Así las comparaciones salen de sumar meses ya traídos.
  const inicioConsulta = inicioDe(
    [desde, anterior.desde, anioAnterior.desde].reduce((a, b) =>
      largoEnMeses(a, b) > 0 ? a : b,
    ),
  );
  const finConsulta = finDe(hasta);

  const [trabajo, pagos, pacientes, primeros, turnosConDeuda] =
    await Promise.all([
      consultaTrabajo(prisma, organizationId, inicioConsulta, finConsulta),
      consultaPagos(prisma, organizationId, inicioConsulta, finConsulta),
      consultaPacientes(
        prisma,
        organizationId,
        inicioDe(desde),
        finDe(hasta),
        porMes,
      ),
      consultaPrimeros(prisma, organizationId),
      buscarTurnosConDeuda(prisma, organizationId),
    ]);

  // ── La serie ──────────────────────────────────────────────────────────
  const mensual = juntarPorMes(trabajo, pagos);
  const claves = clavesDelRango(desde, hasta, porMes);
  const distintasPorClave = new Map(
    pacientes
      .filter((f) => f.anio !== null)
      .map((f) => [
        porMes ? `${f.anio}-${String(f.mes).padStart(2, "0")}` : `${f.anio}`,
        f.pacientes,
      ]),
  );

  const serie = claves.map((clave) => {
    const suma = sumarMeses(mensual, mesesDeLaClave(clave, porMes));
    return armarPeriodo(
      clave.clave,
      clave.anio,
      porMes ? clave.mes + 1 : null,
      suma,
      distintasPorClave.get(clave.clave) ?? 0,
    );
  });

  // ── Totales del período pedido ────────────────────────────────────────
  const mesesPedidos = listarMeses(desde, hasta);
  const sumaTotal = sumarMeses(mensual, mesesPedidos);
  const distintasTotal =
    pacientes.find((f) => f.anio === null)?.pacientes ?? 0;
  const totales = sinClave(
    armarPeriodo("", desde.anio, null, sumaTotal, distintasTotal),
  );

  // ── Comparaciones ─────────────────────────────────────────────────────
  const comparaciones = {
    periodoAnterior: compararCon(mensual, sumaTotal, anterior),
    mismoPeriodoAnioAnterior: compararCon(mensual, sumaTotal, anioAnterior),
  };

  // ── Deuda de hoy ──────────────────────────────────────────────────────
  const tramos = deudaPorAntiguedad(turnosConDeuda, ahora);
  const deudaHoy = {
    alDia: formatearMes(mesDe(ahora)),
    sesiones: tramos.reduce((t, x) => t + x.sesiones, 0),
    monto: tramos.reduce((t, x) => t + x.monto, 0),
    tramos,
  };

  // ── El primer mes con datos ───────────────────────────────────────────
  const primerInstante = [primeros.min_fecha, primeros.min_pago]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return resumenFinanzasSchema.parse({
    desde: formatearMes(desde),
    hasta: formatearMes(hasta),
    granularidad,
    granularidadAutomatica: granularidadPedida === undefined,
    serie,
    totales,
    comparaciones,
    proporcionCobrada: proporcion(sumaTotal),
    deudaHoy,
    primerMesConDatos: primerInstante
      ? formatearMes(mesDe(primerInstante))
      : null,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Las consultas
// ────────────────────────────────────────────────────────────────────────────

function consultaTrabajo(
  prisma: ClientePrisma,
  organizationId: string,
  inicio: Date,
  fin: Date,
): Promise<FilaTrabajo[]> {
  const fecha = enMontevideo("fecha");
  return prisma.$queryRaw<FilaTrabajo[]>(Prisma.sql`
    SELECT
      EXTRACT(YEAR  FROM ${fecha})::int AS anio,
      EXTRACT(MONTH FROM ${fecha})::int AS mes,
      COUNT(*) FILTER (WHERE t.estado = 'realizado')::int AS realizadas,
      COALESCE(SUM(t.tarifa_cobrada) FILTER (WHERE t.estado = 'realizado'), 0)::bigint AS trabajado,
      COUNT(*) FILTER (WHERE t.estado = 'realizado' AND t.pago_estado = 'pagado')::int AS realizadas_cobradas,
      COALESCE(SUM(t.tarifa_cobrada) FILTER (WHERE t.estado = 'realizado' AND t.pago_estado = 'pagado'), 0)::bigint AS trabajado_cobrado,
      COUNT(*) FILTER (WHERE t.estado = 'ausente')::int AS ausencias,
      COALESCE(SUM(t.tarifa_cobrada) FILTER (WHERE t.estado = 'ausente'), 0)::bigint AS ausencias_monto,
      COUNT(*) FILTER (WHERE t.estado = 'cancelado')::int AS canceladas
    FROM turnos t
    WHERE t.organization_id = ${organizationId}
      AND t.fecha >= ${sinZona(inicio)}::timestamp
      AND t.fecha <= ${sinZona(fin)}::timestamp
    GROUP BY 1, 2
  `);
}

function consultaPagos(
  prisma: ClientePrisma,
  organizationId: string,
  inicio: Date,
  fin: Date,
): Promise<FilaPago[]> {
  const pago = enMontevideo("pago_fecha");
  return prisma.$queryRaw<FilaPago[]>(Prisma.sql`
    SELECT
      EXTRACT(YEAR  FROM ${pago})::int AS anio,
      EXTRACT(MONTH FROM ${pago})::int AS mes,
      t.pago_metodo::text AS metodo,
      COUNT(*)::int AS sesiones,
      COALESCE(SUM(t.tarifa_cobrada), 0)::bigint AS monto
    FROM turnos t
    WHERE t.organization_id = ${organizationId}
      AND t.pago_estado = 'pagado'
      AND t.pago_fecha IS NOT NULL
      AND t.pago_fecha >= ${sinZona(inicio)}::timestamp
      AND t.pago_fecha <= ${sinZona(fin)}::timestamp
    GROUP BY 1, 2, 3
  `);
}

/**
 * Pacientes distintas por período, y el total del período pedido en la misma
 * pasada. GROUPING SETS entrega las dos cosas: la fila con `anio` en NULL es
 * el total. Va aparte de la consulta del eje trabajo porque un conteo de
 * DISTINTAS no se puede sumar entre meses —quien vino en marzo y en abril es
 * una sola paciente en el año— y por eso agrupa por el período PEDIDO.
 */
function consultaPacientes(
  prisma: ClientePrisma,
  organizationId: string,
  inicio: Date,
  fin: Date,
  porMes: boolean,
): Promise<FilaPacientes[]> {
  const fecha = enMontevideo("fecha");
  const mes = porMes
    ? Prisma.sql`EXTRACT(MONTH FROM ${fecha})::int`
    : Prisma.sql`NULL::int`;
  return prisma.$queryRaw<FilaPacientes[]>(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM ${fecha})::int AS anio,
      ${mes} AS mes,
      COUNT(DISTINCT t.paciente_id)::int AS pacientes
    FROM turnos t
    WHERE t.organization_id = ${organizationId}
      AND t.estado = 'realizado'
      AND t.fecha >= ${sinZona(inicio)}::timestamp
      AND t.fecha <= ${sinZona(fin)}::timestamp
    GROUP BY GROUPING SETS ((1, 2), ())
  `);
}

/** El turno más viejo y el pago más viejo de la organización. Una fila. */
async function consultaPrimeros(
  prisma: ClientePrisma,
  organizationId: string,
): Promise<{ min_fecha: Date | null; min_pago: Date | null }> {
  const [fila] = await prisma.$queryRaw<
    { min_fecha: Date | null; min_pago: Date | null }[]
  >(Prisma.sql`
    SELECT MIN(t.fecha) AS min_fecha, MIN(t.pago_fecha) AS min_pago
    FROM turnos t
    WHERE t.organization_id = ${organizationId}
  `);
  return fila ?? { min_fecha: null, min_pago: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Las cuentas, en memoria y sobre meses enteros
// ────────────────────────────────────────────────────────────────────────────

interface Acumulado {
  cobrado: number;
  sesionesCobradas: number;
  trabajado: number;
  sesionesRealizadas: number;
  trabajadoCobrado: number;
  sesionesRealizadasCobradas: number;
  ausencias: number;
  ausenciasMonto: number;
  canceladas: number;
  porMetodo: Map<MetodoCobro, { sesiones: number; monto: number }>;
}

const vacio = (): Acumulado => ({
  cobrado: 0,
  sesionesCobradas: 0,
  trabajado: 0,
  sesionesRealizadas: 0,
  trabajadoCobrado: 0,
  sesionesRealizadasCobradas: 0,
  ausencias: 0,
  ausenciasMonto: 0,
  canceladas: 0,
  porMetodo: new Map(),
});

const claveMes = ({ anio, mes }: MesMvd) => `${anio}-${mes}`;

/** Las filas de las dos consultas, indexadas por mes de Montevideo. */
function juntarPorMes(
  trabajo: FilaTrabajo[],
  pagos: FilaPago[],
): Map<string, Acumulado> {
  const mapa = new Map<string, Acumulado>();
  const traer = (anio: number, mes: number) => {
    const clave = claveMes({ anio, mes: mes - 1 });
    const actual = mapa.get(clave) ?? vacio();
    mapa.set(clave, actual);
    return actual;
  };

  for (const f of trabajo) {
    const a = traer(f.anio, f.mes);
    a.sesionesRealizadas += f.realizadas;
    a.trabajado += n(f.trabajado);
    a.sesionesRealizadasCobradas += f.realizadas_cobradas;
    a.trabajadoCobrado += n(f.trabajado_cobrado);
    a.ausencias += f.ausencias;
    a.ausenciasMonto += n(f.ausencias_monto);
    a.canceladas += f.canceladas;
  }

  for (const f of pagos) {
    const a = traer(f.anio, f.mes);
    a.sesionesCobradas += f.sesiones;
    a.cobrado += n(f.monto);
    // pago_metodo es opcional en el esquema: un cobro sin método declarado
    // entra igual, con la etiqueta `sin_metodo`, para que la suma por método
    // siempre cierre con el total cobrado.
    const metodo = (f.metodo ?? "sin_metodo") as MetodoCobro;
    const previo = a.porMetodo.get(metodo) ?? { sesiones: 0, monto: 0 };
    previo.sesiones += f.sesiones;
    previo.monto += n(f.monto);
    a.porMetodo.set(metodo, previo);
  }

  return mapa;
}

function sumarMeses(mensual: Map<string, Acumulado>, meses: MesMvd[]): Acumulado {
  const total = vacio();
  for (const mes of meses) {
    const a = mensual.get(claveMes(mes));
    if (!a) continue;
    total.cobrado += a.cobrado;
    total.sesionesCobradas += a.sesionesCobradas;
    total.trabajado += a.trabajado;
    total.sesionesRealizadas += a.sesionesRealizadas;
    total.trabajadoCobrado += a.trabajadoCobrado;
    total.sesionesRealizadasCobradas += a.sesionesRealizadasCobradas;
    total.ausencias += a.ausencias;
    total.ausenciasMonto += a.ausenciasMonto;
    total.canceladas += a.canceladas;
    for (const [metodo, v] of a.porMetodo) {
      const previo = total.porMetodo.get(metodo) ?? { sesiones: 0, monto: 0 };
      previo.sesiones += v.sesiones;
      previo.monto += v.monto;
      total.porMetodo.set(metodo, previo);
    }
  }
  return total;
}

/** ¿Hubo algún movimiento en estos meses? Distingue "no hay datos" de "hubo
 *  datos y dieron cero", que es lo que separa un null de un 0 honesto. */
function huboMovimiento(mensual: Map<string, Acumulado>, meses: MesMvd[]): boolean {
  return meses.some((mes) => mensual.has(claveMes(mes)));
}

function listarMeses(desde: MesMvd, hasta: MesMvd): MesMvd[] {
  const salida: MesMvd[] = [];
  for (let i = 0; i < largoEnMeses(desde, hasta); i += 1) {
    salida.push(correrMeses(desde, i));
  }
  return salida;
}

interface ClavePeriodo {
  clave: string;
  anio: number;
  mes: number;
}

function clavesDelRango(desde: MesMvd, hasta: MesMvd, porMes: boolean): ClavePeriodo[] {
  if (porMes) {
    return listarMeses(desde, hasta).map((m) => ({
      clave: formatearMes(m),
      anio: m.anio,
      mes: m.mes,
    }));
  }
  const anios: ClavePeriodo[] = [];
  for (let anio = desde.anio; anio <= hasta.anio; anio += 1) {
    anios.push({ clave: `${anio}`, anio, mes: 0 });
  }
  return anios;
}

/** Los meses que caen dentro de una clave de la serie. Con granularidad año
 *  son los doce del año, pero sólo los que existen en el mapa suman: un año
 *  a medias en la punta del rango no inventa meses. */
function mesesDeLaClave(clave: ClavePeriodo, porMes: boolean): MesMvd[] {
  if (porMes) return [{ anio: clave.anio, mes: clave.mes }];
  return Array.from({ length: 12 }, (_, mes) => ({ anio: clave.anio, mes }));
}

/** Los totales son el mismo objeto que un período de la serie, menos lo que
 *  identifica al período. Una sola forma para las dos cosas: la pantalla
 *  dibuja una barra y el encabezado con el mismo código. */
function sinClave(periodo: PeriodoFinanzas) {
  const { clave, anio, mes, ...resto } = periodo;
  void clave;
  void anio;
  void mes;
  return resto;
}

/** Redondeo al peso: los montos ya son enteros y sólo los promedios dividen.
 *  Media al alza (todos los valores son ≥ 0, así que Math.round alcanza). */
const alPeso = (x: number) => Math.round(x);

function armarPeriodo(
  clave: string,
  anio: number,
  mes: number | null,
  a: Acumulado,
  pacientesDistintas: number,
): PeriodoFinanzas {
  return {
    clave,
    anio,
    mes,
    cobrado: a.cobrado,
    sesionesCobradas: a.sesionesCobradas,
    trabajado: a.trabajado,
    sesionesRealizadas: a.sesionesRealizadas,
    trabajadoCobrado: a.trabajadoCobrado,
    sesionesRealizadasCobradas: a.sesionesRealizadasCobradas,
    trabajadoSinCobrar: a.trabajado - a.trabajadoCobrado,
    sesionesRealizadasSinCobrar:
      a.sesionesRealizadas - a.sesionesRealizadasCobradas,
    ausencias: a.ausencias,
    ausenciasMonto: a.ausenciasMonto,
    canceladas: a.canceladas,
    pacientesDistintas,
    tarifaPromedio:
      a.sesionesRealizadas === 0
        ? null
        : alPeso(a.trabajado / a.sesionesRealizadas),
    cobradoPorMetodo: [...a.porMetodo.entries()]
      .map(([metodo, v]) => ({ metodo, ...v }))
      .sort((x, y) => y.monto - x.monto || x.metodo.localeCompare(y.metodo)),
  };
}

function proporcion(a: Acumulado) {
  const hay = a.sesionesRealizadas > 0;
  const razon = hay ? a.sesionesRealizadasCobradas / a.sesionesRealizadas : 0;
  return {
    deCadaDiez: hay ? Math.round(razon * 10) : null,
    porcentaje: hay ? Math.round(razon * 100) : null,
    sesionesRealizadas: a.sesionesRealizadas,
    sesionesRealizadasCobradas: a.sesionesRealizadasCobradas,
  };
}

/** Variación porcentual entera. null si la base era cero: no existe el
 *  "creció infinito", y un 0 ahí sería mentira. */
function porcentaje(nuevo: number, viejo: number): number | null {
  if (viejo === 0) return null;
  return Math.round(((nuevo - viejo) / viejo) * 100);
}

function compararCon(
  mensual: Map<string, Acumulado>,
  actual: Acumulado,
  ventana: { desde: MesMvd; hasta: MesMvd },
) {
  const meses = listarMeses(ventana.desde, ventana.hasta);
  if (!huboMovimiento(mensual, meses)) return null;
  const previo = sumarMeses(mensual, meses);
  return {
    desde: formatearMes(ventana.desde),
    hasta: formatearMes(ventana.hasta),
    cobrado: previo.cobrado,
    trabajado: previo.trabajado,
    sesionesRealizadas: previo.sesionesRealizadas,
    variacionCobrado: actual.cobrado - previo.cobrado,
    variacionTrabajado: actual.trabajado - previo.trabajado,
    variacionSesionesRealizadas:
      actual.sesionesRealizadas - previo.sesionesRealizadas,
    porcentajeCobrado: porcentaje(actual.cobrado, previo.cobrado),
    porcentajeTrabajado: porcentaje(actual.trabajado, previo.trabajado),
  };
}
