// Caso de uso: el WhatsApp asistido. Con el canal en `whatsapp` (hoy siempre:
// CANAL_RECORDATORIO_VIGENTE), la app no manda el recordatorio por su cuenta: le
// prepara a la profesional el mensaje de cada turno que corresponde avisar
// hoy, ella lo abre en WhatsApp y lo manda desde su teléfono, y la app
// registra que lo abrió.
//
// ─── QUÉ TURNOS CORRESPONDE AVISAR HOY ──────────────────────────────────────
//
// Sale de los turnos, con una sola regla (correspondeAvisarHoy):
//   - el turno sigue programado y no empezó (whereTurnoAvisable) y la
//     paciente está activa;
//   - su momento de aviso (calcularProgramadoEn, con el modo de Tu
//     consultorio) ya llegó hoy o antes: un turno agendado hoy para esta
//     tarde, cuyo momento fue ayer a las 20:00, entra hoy;
//   - no se avisó antes de hoy para su fecha vigente. Lo avisado hoy sigue
//     en la lista, marcado: es el aviso de hoy;
//   - si se avisó otra fecha (lo movieron después), es un cambio de horario
//     y entra ya, falte lo que falte para el turno.
// Antes la lista salía de las filas de envios_sms que dejaba el cron del
// SMS; el SMS ya no existe.
//
// ─── EL TEXTO ───────────────────────────────────────────────────────────────
//
// textoDelRecordatorio (src/lib/sms/texto.ts), con el motivo que decide la
// regla (recordatorio o cambio de horario) y la plantilla vigente. El
// teléfono es el de la ficha HOY.
//
// ─── "YA AVISADO" ───────────────────────────────────────────────────────────
//
// Una fila de avisos_whatsapp por cada vez que abrió el enlace, con la fecha
// del turno que avisó. La app no sabe si el mensaje salió; sabe que lo
// abrió. `avisadoEn` es la última apertura para la fecha VIGENTE: si después
// movió el turno, el aviso nuevo vuelve a estar pendiente, y la apertura
// vieja cuenta como "la paciente tenía el horario anterior": el aviso nuevo
// es un cambio de horario y sale ya.

import { agregarDiasMvd, finDelDiaMvd, inicioDelDiaMvd } from "@/lib/fechas-montevideo";
import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import {
  calcularProgramadoEn, CANAL_RECORDATORIO_VIGENTE, normalizarRecordatorioModo, type RecordatorioModo,
} from "@/lib/recordatorios-programacion";
import { textoDelRecordatorio } from "@/lib/sms/texto";
import { enlaceWhatsapp } from "@/lib/whatsapp";
import type { AvisoDelTurno, AvisoWhatsappRegistrado, RecordatorioWhatsapp, RecordatoriosWhatsappDeHoy } from "@/types/domain";

import { auditar } from "../auditoria";
import { ApiError } from "../responses";
import { whereTurnoAvisable } from "./envios-del-turno";
import { tomarLockDeAgenda } from "./solapamiento-turnos";

type ClientePrisma = typeof db;

export interface ListarRecordatoriosParams {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
}

/**
 * Los turnos cuyo recordatorio corresponde hoy, con el enlace de WhatsApp
 * listo, ordenados por la hora del turno. Con canal `sms` devuelve la lista
 * vacía (y el canal, para que la pantalla decida si muestra el bloque).
 */
export async function listarRecordatoriosDeHoy({
  prisma,
  organizationId,
  ahora,
}: ListarRecordatoriosParams): Promise<RecordatoriosWhatsappDeHoy> {
  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId },
    select: {
      templateRecordatorio: true,
      direccion: true,
      nombreProfesional: true,
      whatsappOrigen: true,
      recordatorioModo: true,
    },
  });
  if (!configuracion) throw new ApiError("Configuración no encontrada", 404);

  // Sólo WhatsApp: lo guardado no cuenta (CANAL_RECORDATORIO_VIGENTE).
  const canal = CANAL_RECORDATORIO_VIGENTE;
  if (canal === "sms") return { canal, turnos: [] };

  const finHoy = finDelDiaMvd(ahora);
  const modo = normalizarRecordatorioModo(configuracion.recordatorioModo);
  const candidatos = await prisma.turno.findMany({
    where: {
      organizationId,
      ...whereTurnoAvisable(ahora),
      paciente: { activo: true },
      // El aviso más temprano es dos días antes (dos_dias_antes): un turno
      // más lejano sólo entra si es un cambio de horario (tiene un aviso).
      OR: [
        { fecha: { lte: agregarDiasMvd(finHoy, 3) } },
        { avisosWhatsapp: { some: { tipo: "recordatorio" } } },
      ],
    },
    select: {
      id: true,
      fecha: true,
      paciente: { select: { id: true, nombre: true, apellido: true, telefono: true } },
      avisosWhatsapp: { where: { tipo: "recordatorio" }, select: { fechaTurno: true, abiertoEn: true } },
    },
  });

  const turnos: RecordatorioWhatsapp[] = candidatos
    .flatMap((turno) => {
      const corresponde = correspondeAvisarHoy({ fecha: turno.fecha, avisos: turno.avisosWhatsapp }, modo, ahora);
      if (!corresponde) return [];
      const { paciente } = turno;
      const telefono = paciente.telefono.trim();
      const enlace = telefono
        ? enlaceWhatsapp(telefono, textoDelRecordatorio(corresponde.motivo, configuracion, paciente, turno.fecha))
        : null;
      return [{
        turnoId: turno.id,
        fecha: turno.fecha.toISOString(),
        paciente: { id: paciente.id, nombre: paciente.nombre, apellido: paciente.apellido, telefono },
        enlace,
        motivo: enlace ? null : ("sin_telefono" as const),
        avisadoEn: corresponde.avisadoEn?.toISOString() ?? null,
      }];
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return { canal, turnos };
}

/**
 * La regla única de "a quién se avisa hoy", para un turno que ya sigue
 * programado, no empezó y es de una paciente activa (eso lo filtra la
 * consulta). Devuelve null si hoy no le corresponde; si le corresponde, con
 * qué texto (recordatorio o cambio de horario) y la última apertura de hoy
 * para su fecha vigente.
 */
export function correspondeAvisarHoy(
  turno: { fecha: Date; avisos: ReadonlyArray<{ fechaTurno: Date; abiertoEn: Date }> },
  modo: RecordatorioModo,
  ahora: Date,
): { motivo: "recordatorio_turno" | "cambio_de_horario"; avisadoEn: Date | null } | null {
  const deEstaFecha = turno.avisos.filter((a) => a.fechaTurno.getTime() === turno.fecha.getTime());
  const deOtraFecha = deEstaFecha.length < turno.avisos.length;
  const motivo = deOtraFecha ? "cambio_de_horario" : "recordatorio_turno";
  const ultimo = deEstaFecha.reduce<Date | null>((max, a) => (!max || a.abiertoEn > max ? a.abiertoEn : max), null);
  if (ultimo) return ultimo >= inicioDelDiaMvd(ahora) ? { motivo, avisadoEn: ultimo } : null;
  if (deOtraFecha) return { motivo, avisadoEn: null };
  return calcularProgramadoEn(turno.fecha, modo) <= finDelDiaMvd(ahora) ? { motivo, avisadoEn: null } : null;
}

/** El aviso de UN turno, para el bloque "Recordatorio" del detalle: la
 *  última apertura del enlace para su fecha vigente, o null si todavía no se
 *  avisó. 404 si el turno no es de la organización. */
export async function avisoDelTurno({
  prisma,
  organizationId,
  turnoId,
}: { prisma: ClientePrisma; organizationId: string; turnoId: string }): Promise<AvisoDelTurno> {
  const turno = await prisma.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: { fecha: true, avisosWhatsapp: { where: { tipo: "recordatorio" }, select: { fechaTurno: true, abiertoEn: true } } },
  });
  if (!turno) throw new ApiError("Turno no encontrado", 404);
  const ultimo = turno.avisosWhatsapp
    .filter((a) => a.fechaTurno.getTime() === turno.fecha.getTime())
    .reduce<Date | null>((max, a) => (!max || a.abiertoEn > max ? a.abiertoEn : max), null);
  return { avisadoEn: ultimo?.toISOString() ?? null };
}

export interface RegistrarAvisoParams {
  prisma: ClientePrisma;
  organizationId: string;
  turnoId: string;
  usuarioId: string;
  ahora: Date;
  /** La fecha del turno que decía el enlace que abrió (la `fecha` que le dio
   *  el GET). Si el turno se movió entre el GET y el toque, la que vale es
   *  ésta: el mensaje que mandó citaba ese horario. Sin ella, la vigente. */
  fechaTurno?: Date;
}

/**
 * Registra que abrió el enlace de WhatsApp del turno: una fila más en
 * avisos_whatsapp y su evento de auditoría, en la misma transacción (y, si
 * el enlace era de otra fecha, la lista lo vuelve a pedir como cambio de
 * horario). Repetir
 * crea otra fila (abrió dos veces) y no rompe nada. 404 si el turno no es de
 * la organización: no se revela si existe en otra.
 */
export async function registrarAviso({
  prisma,
  organizationId,
  turnoId,
  usuarioId,
  ahora,
  fechaTurno,
}: RegistrarAvisoParams): Promise<AvisoWhatsappRegistrado> {
  await prisma.$transaction(async (tx) => {
    // El mismo lock que mover el turno (actualizarTurno): o esta apertura ve
    // la fecha nueva, o reprogramar ve esta apertura. Sin él, las dos
    // transacciones pueden no verse y la corrección no sale.
    await tomarLockDeAgenda(tx, organizationId);
    const turno = await tx.turno.findFirst({ where: { id: turnoId, organizationId }, select: { fecha: true } });
    if (!turno) throw new ApiError("Turno no encontrado", 404);
    const avisada = fechaTurno ?? turno.fecha;

    const aviso = await tx.avisoWhatsapp.create({
      data: { organizationId, turnoId, tipo: "recordatorio", fechaTurno: avisada, abiertoEn: ahora, usuarioId },
      select: { id: true },
    });
    // Si abrió el mensaje de un horario que ya no es el del turno (lo movió
    // entre la lista y el toque), esta apertura queda con la fecha vieja: la
    // regla de la lista (correspondeAvisarHoy) lo trae de vuelta como cambio
    // de horario.
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.recordatorio.whatsappAbierto,
      entidad: "turno",
      entidadId: turnoId,
      detalle: { avisoId: aviso.id },
    });
  });

  return { avisadoEn: ahora.toISOString() };
}
