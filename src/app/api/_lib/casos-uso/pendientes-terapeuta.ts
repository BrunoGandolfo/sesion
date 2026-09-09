// Caso de uso: lo que espera a la terapeuta cuando abre la app.
//
// Tres listas, cada una con una acción posible y un final: revisar la nota,
// cobrar la sesión, hacer firmar la autorización. Cuando las tres están
// vacías no hay nada pendiente y la pantalla de Hoy no muestra el bloque.
//
// Por qué existe: hoy la única forma de encontrar una nota sin aprobar es
// acordarse de qué paciente fue, entrar a su ficha y abrir la pestaña
// correcta. Si el turno no era de hoy, ni siquiera aparece el botón. Las
// notas de ayer no existen para la app: existen solo en la memoria de
// Mariana. Esto las trae al frente sin importar la fecha.
//
// Las tres reglas se toman de domain.ts y de lib/consentimiento.ts, no se
// reescriben acá: `esDeudaPendiente` decide qué es una sesión sin cobrar y
// `esConsentimientoVigente` decide qué es una autorización vigente.
//
// Lo que no se cobra va agrupado por paciente (con el total al lado): se le
// cobra a una persona, aunque deba tres sesiones. Una lista de turnos
// sueltos hacía escribir tres veces al mismo paciente.
//
// ─── UNA SOLA CUENTA DE DEUDA ───────────────────────────────────────────
//
// Este archivo tenía su propia consulta de turnos impagos y su propio
// agrupador. Contra `buscarTurnosConDeuda` + `calcularDeudores` —lo que ya
// usa /api/deudores— daban dos números distintos en la misma pantalla:
// "11 pacientes te deben" arriba y "10 pacientes" en el KPI, con tres
// nombres arriba que no eran los tres de abajo. Para ella no hay dos
// criterios: hay un número que no coincide consigo mismo.
//
// Ahora la deuda sale de una sola función pura, `deudoresDeHoy`, que es
// `calcularDeudores` con la forma que viaja por la red. La consumen las tres
// apariciones de la deuda en Hoy (el bloque de pendientes, el KPI "Por
// cobrar" y "Te deben") y también la lista de /api/dashboard. El orden es el
// que devuelve `calcularDeudores` —monto descendente—, que es el mismo con
// el que Cobros dibuja su lista.
//
// Sin request ni Response: recibe prisma y `ahora` como parámetros.

import type { db } from "@/lib/db";
import { esConsentimientoVigente } from "@/lib/consentimiento";
import { finDelDiaMvd, inicioDelDiaMvd } from "@/lib/fechas-montevideo";

import type {
  DeudaPaciente,
  NotaParaRevisar,
  PacienteSinCobrar,
  PendientesTerapeuta,
  TotalSinCobrar,
  TurnoSinAutorizacion,
} from "@/types/domain";

import {
  buscarTurnosConDeuda,
  calcularDeudores,
  type TurnoConDeuda,
} from "../domain";

type ClientePrisma = typeof db;

export interface PendientesTerapeutaParams {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
  /** Los turnos con deuda, si quien llama ya los leyó. /api/dashboard los
   *  necesita también para el KPI y para la lista de "Te deben", así que los
   *  pasa y la consulta se hace una sola vez. Sin esto se leen acá. */
  turnosConDeuda?: TurnoConDeuda[];
}

/**
 * Estados de turno en los que todavía se puede grabar. Espejo del guard de
 * POST /api/sesion-clinica ("turno programado o realizado") y de cómo
 * paciente-detail-view elige el turno de hoy: pedir la autorización de un
 * turno cancelado o al que la paciente no vino sería ruido.
 */
const ESTADOS_GRABABLES = ["programado", "realizado"] as const;

function nombreCompleto(paciente: {
  nombre: string;
  apellido: string;
}): string {
  return `${paciente.nombre} ${paciente.apellido}`;
}

function porFechaAscendente(a: { fecha: string }, b: { fecha: string }): number {
  return a.fecha.localeCompare(b.fecha);
}

/** Fecha del turno impago más viejo de cada paciente, ISO. Es lo que
 *  `PacienteSinCobrar` pide y lo que desempata el orden. */
function masAntiguoPorPaciente(turnos: TurnoConDeuda[]): Map<string, string> {
  const masAntiguo = new Map<string, string>();
  for (const turno of turnos) {
    const fecha = turno.fecha.toISOString();
    const previa = masAntiguo.get(turno.pacienteId);
    if (!previa || fecha < previa) masAntiguo.set(turno.pacienteId, fecha);
  }
  return masAntiguo;
}

/**
 * Los deudores de la organización, en la forma en que viajan por la red y en
 * el orden en que se muestran: monto descendente —el de `calcularDeudores`, el
 * mismo con el que Cobros dibuja su lista— y, a igual monto, la deuda más
 * vieja primero, para que el orden no dependa de cómo vino la consulta.
 *
 * Es la fuente única de la deuda de la pantalla de Hoy: la usan el bloque de
 * pendientes (vía `sinCobrar`), el KPI "Por cobrar" y "Te deben". Pura: recibe
 * los turnos que ya leyó `buscarTurnosConDeuda` y no vuelve a la base.
 */
export function deudoresDeHoy(
  turnos: TurnoConDeuda[],
  ahora: Date,
): DeudaPaciente[] {
  const masAntiguo = masAntiguoPorPaciente(turnos);
  return calcularDeudores(turnos, ahora)
    .map((deudor) => ({
      pacienteId: deudor.pacienteId,
      nombre: deudor.nombre,
      apellido: deudor.apellido,
      sesionesImpagas: deudor.sesionesImpagas,
      montoTotal: deudor.montoTotal,
      diasAtraso: deudor.diasAtraso ?? 0,
    }))
    .sort((a, b) =>
      b.montoTotal !== a.montoTotal
        ? b.montoTotal - a.montoTotal
        : (masAntiguo.get(a.pacienteId) ?? "").localeCompare(
            masAntiguo.get(b.pacienteId) ?? "",
          ),
    );
}

function totalizar(sinCobrar: PacienteSinCobrar[]): TotalSinCobrar {
  return {
    sesiones: sinCobrar.reduce((total, p) => total + p.sesiones, 0),
    monto: sinCobrar.reduce((total, p) => total + p.monto, 0),
    pacientes: sinCobrar.length,
  };
}

/** Las tres formas en que la deuda aparece en Hoy, salidas de una sola
 *  cuenta: la lista con nombre y apellido ("Te deben"), la lista con el
 *  nombre unido (el bloque de pendientes) y el total (el KPI). */
export interface DeudaDeHoy {
  deudores: DeudaPaciente[];
  sinCobrar: PacienteSinCobrar[];
  totalSinCobrar: TotalSinCobrar;
}

/**
 * La deuda de la organización, una sola vez y en un solo orden, en las tres
 * formas que consume la pantalla de Hoy. Pura: recibe los turnos que ya leyó
 * `buscarTurnosConDeuda` y no vuelve a la base.
 *
 * Las tres salidas tienen los mismos pacientes, en el mismo orden y con los
 * mismos montos, por construcción: `sinCobrar` es `deudores` con el nombre
 * unido y `totalSinCobrar` es su suma. Es lo que hace que el número de
 * arriba de la pantalla y el del KPI no puedan volver a discrepar.
 */
export function deudaDeHoy(
  turnos: TurnoConDeuda[],
  ahora: Date,
): DeudaDeHoy {
  const deudores = deudoresDeHoy(turnos, ahora);
  const masAntiguo = masAntiguoPorPaciente(turnos);
  const sinCobrar: PacienteSinCobrar[] = deudores.map((deudor) => ({
    pacienteId: deudor.pacienteId,
    pacienteNombre: `${deudor.nombre} ${deudor.apellido}`,
    sesiones: deudor.sesionesImpagas,
    monto: deudor.montoTotal,
    masAntiguo: masAntiguo.get(deudor.pacienteId) ?? "",
  }));

  return { deudores, sinCobrar, totalSinCobrar: totalizar(sinCobrar) };
}

export async function pendientesTerapeuta({
  prisma,
  organizationId,
  ahora,
  turnosConDeuda,
}: PendientesTerapeutaParams): Promise<PendientesTerapeuta> {
  const inicioDelDia = inicioDelDiaMvd(ahora);
  const finDelDia = finDelDiaMvd(ahora);

  const [sesionesEnRevision, turnosImpagos, turnosDeHoy] = await Promise.all([
    // 1. Notas generadas que todavía nadie aprobó. De cualquier fecha: una
    //    nota del jueves pasado sigue siendo trabajo clínico pendiente.
    prisma.sesionClinica.findMany({
      where: { organizationId, estado: "revision" },
      select: {
        id: true,
        turnoId: true,
        turno: {
          select: {
            fecha: true,
            paciente: { select: { id: true, nombre: true, apellido: true } },
          },
        },
      },
    }),

    // 2. Sesiones hechas y sin cobrar. La consulta es la de /api/deudores,
    //    no una propia: la deuda de esta pantalla y la de Cobros tienen que
    //    ser la misma o el número no coincide consigo mismo. Si quien llama
    //    ya la leyó, no se vuelve a la base.
    turnosConDeuda ?? buscarTurnosConDeuda(prisma, organizationId),

    // 3. Turnos de hoy, para cruzar contra las autorizaciones vigentes.
    prisma.turno.findMany({
      where: {
        organizationId,
        fecha: { gte: inicioDelDia, lte: finDelDia },
        estado: { in: [...ESTADOS_GRABABLES] },
      },
      select: {
        id: true,
        fecha: true,
        paciente: { select: { id: true, nombre: true, apellido: true } },
      },
    }),
  ]);

  const notasParaRevisar: NotaParaRevisar[] = sesionesEnRevision
    .map((sesion) => ({
      sesionId: sesion.id,
      turnoId: sesion.turnoId,
      pacienteId: sesion.turno.paciente.id,
      pacienteNombre: nombreCompleto(sesion.turno.paciente),
      fecha: sesion.turno.fecha.toISOString(),
    }))
    .sort(porFechaAscendente);

  const { sinCobrar, totalSinCobrar } = deudaDeHoy(turnosImpagos, ahora);

  // Una sola consulta de consentimientos para todas las pacientes del día.
  const pacientesDeHoy = [...new Set(turnosDeHoy.map((t) => t.paciente.id))];
  const consentimientos = pacientesDeHoy.length
    ? await prisma.consentimientoGrabacion.findMany({
        where: { organizationId, pacienteId: { in: pacientesDeHoy } },
        select: { pacienteId: true, firmadoEn: true, revocadoEn: true },
      })
    : [];

  const autorizadas = new Set(
    consentimientos
      .filter((c) => esConsentimientoVigente(c))
      .map((c) => c.pacienteId),
  );

  const sinAutorizacion: TurnoSinAutorizacion[] = turnosDeHoy
    .filter((turno) => !autorizadas.has(turno.paciente.id))
    .map((turno) => ({
      turnoId: turno.id,
      pacienteId: turno.paciente.id,
      pacienteNombre: nombreCompleto(turno.paciente),
      fecha: turno.fecha.toISOString(),
    }))
    .sort(porFechaAscendente);

  return { notasParaRevisar, sinCobrar, totalSinCobrar, sinAutorizacion };
}
