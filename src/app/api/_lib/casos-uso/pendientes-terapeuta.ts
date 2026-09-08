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
// Sin request ni Response: recibe prisma y `ahora` como parámetros.

import type { db } from "@/lib/db";
import { esConsentimientoVigente } from "@/lib/consentimiento";
import { finDelDiaMvd, inicioDelDiaMvd } from "@/lib/fechas-montevideo";

import {
  esDeudaPendiente,
  type NotaParaRevisar,
  type PacienteSinCobrar,
  type PendientesTerapeuta,
  type TotalSinCobrar,
  type TurnoSinAutorizacion,
} from "../domain";

type ClientePrisma = typeof db;

export interface PendientesTerapeutaParams {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
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

/** Turno impago tal como lo lee la consulta 2. */
type TurnoImpago = {
  id: string;
  fecha: Date;
  estado: string;
  pagoEstado: string;
  tarifaCobrada: number;
  paciente: { id: string; nombre: string; apellido: string };
};

/**
 * Deuda por paciente, no por sesión: se cobra a una persona, aunque deba
 * tres sesiones. Orden por monto descendente —lo que más pesa arriba— y, a
 * igual monto, primero la deuda más vieja.
 */
function agruparSinCobrar(turnos: TurnoImpago[]): PacienteSinCobrar[] {
  const porPaciente = new Map<string, PacienteSinCobrar>();

  for (const turno of turnos) {
    const fecha = turno.fecha.toISOString();
    const actual = porPaciente.get(turno.paciente.id);

    if (!actual) {
      porPaciente.set(turno.paciente.id, {
        pacienteId: turno.paciente.id,
        pacienteNombre: nombreCompleto(turno.paciente),
        sesiones: 1,
        monto: turno.tarifaCobrada,
        masAntiguo: fecha,
      });
      continue;
    }

    actual.sesiones += 1;
    actual.monto += turno.tarifaCobrada;
    if (fecha < actual.masAntiguo) actual.masAntiguo = fecha;
  }

  return [...porPaciente.values()].sort((a, b) =>
    b.monto !== a.monto
      ? b.monto - a.monto
      : a.masAntiguo.localeCompare(b.masAntiguo),
  );
}

function totalizar(sinCobrar: PacienteSinCobrar[]): TotalSinCobrar {
  return {
    sesiones: sinCobrar.reduce((total, p) => total + p.sesiones, 0),
    monto: sinCobrar.reduce((total, p) => total + p.monto, 0),
    pacientes: sinCobrar.length,
  };
}

export async function pendientesTerapeuta({
  prisma,
  organizationId,
  ahora,
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

    // 2. Sesiones hechas y sin cobrar. El where es la proyección en SQL de
    //    esDeudaPendiente (misma pareja de columnas que buscarTurnosConDeuda);
    //    el predicado se aplica igual al leer, para que la regla siga siendo
    //    una sola si algún día cambia.
    prisma.turno.findMany({
      where: {
        organizationId,
        estado: "realizado",
        pagoEstado: "pendiente",
        fecha: { lte: ahora },
      },
      select: {
        id: true,
        fecha: true,
        estado: true,
        pagoEstado: true,
        tarifaCobrada: true,
        paciente: { select: { id: true, nombre: true, apellido: true } },
      },
    }),

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

  const sinCobrar = agruparSinCobrar(turnosImpagos.filter(esDeudaPendiente));
  const totalSinCobrar = totalizar(sinCobrar);

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
