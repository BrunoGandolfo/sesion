// Caso de uso: el WhatsApp asistido. Con Configuracion.canalRecordatorio en
// `whatsapp` (o `ambos`), la app no manda el recordatorio por su cuenta: le
// prepara a la profesional el mensaje de cada turno que corresponde avisar
// hoy, ella lo abre en WhatsApp y lo manda desde su teléfono, y la app
// registra que lo abrió.
//
// ─── QUÉ TURNOS CORRESPONDE AVISAR HOY ──────────────────────────────────────
//
// Lo dice envios_sms, no una cuenta nueva: el envío del turno cuyo
// `programado_en` cae en el día de hoy de Montevideo. Es la misma fila que el
// cron despacha (o cancela, con canal `whatsapp`: casos-uso/despachar-sms.ts),
// así que la lista de WhatsApp y el SMS hablan siempre del mismo día. Si
// mañana cambia la regla de cuándo se avisa (recordatorios-programacion.ts),
// cambia para los dos canales.
//
// Con una excepción, la misma que hace el cron: un envío que quedó VENCIDO
// sin que el cron lo haya tratado. Un turno agendado hoy para esta tarde (con
// `dia_anterior`, `programado_en` es ayer a las 20:00), o uno reabierto hoy
// que revive su envío viejo: el SMS saldría en el próximo tick. Para WhatsApp
// ese aviso es de hoy, el día en que el cron lo trata. Por eso entra también
// lo programado ANTES de hoy que sigue pendiente, o que se cerró hoy (con
// canal `whatsapp`, el cron lo cancela en ese tick). Lo programado ayer y
// tratado ayer fue el aviso de ayer.
//
// De esas filas cuenta sólo la de la FECHA VIGENTE del turno (su clave
// turno:<id>:<fecha>): un turno movido deja su envío viejo cancelado con la
// fecha anterior, y ese no es un aviso de hoy. El turno tiene que seguir
// programado y no haber empezado, la paciente activa y sin baja: los mismos
// cortes que haría el cron antes de mandar.
//
// ─── EL TEXTO ───────────────────────────────────────────────────────────────
//
// textoDelRecordatorio (src/lib/sms/texto.ts), la misma función que usa el
// cron, con el motivo del envío (recordatorio o cambio de horario) y la
// plantilla vigente. El teléfono es el de la ficha HOY, no el congelado en el
// envío: si lo cargó después de agendar, el enlace aparece.
//
// ─── "YA AVISADO" ───────────────────────────────────────────────────────────
//
// Una fila de avisos_whatsapp por cada vez que abrió el enlace, con la fecha
// del turno que avisó. La app no sabe si el mensaje salió; sabe que lo
// abrió. `avisadoEn` es la última apertura para la fecha VIGENTE: si después
// movió el turno, el aviso nuevo vuelve a estar pendiente. Y esa apertura
// vieja cuenta como "la paciente tenía el horario anterior" al reprogramar
// (envios-del-turno.ts): el aviso nuevo es un cambio de horario y sale ya.

import { inicioDelDiaMvd, finDelDiaMvd } from "@/lib/fechas-montevideo";
import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import { textoDelRecordatorio } from "@/lib/sms/texto";
import { enlaceWhatsapp } from "@/lib/whatsapp";
import type { AvisoWhatsappRegistrado, RecordatorioWhatsapp, RecordatoriosWhatsappDeHoy } from "@/types/domain";

import { auditar } from "../auditoria";
import { ApiError } from "../responses";
import { claveDelTurno, ESTADOS_CON_ENVIO_PENDIENTE, MOTIVO_CANAL_WHATSAPP } from "./envios-del-turno";
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
      canalRecordatorio: true,
      templateRecordatorio: true,
      direccion: true,
      nombreProfesional: true,
      whatsappOrigen: true,
    },
  });
  if (!configuracion) throw new ApiError("Configuración no encontrada", 404);

  const canal = configuracion.canalRecordatorio;
  if (canal === "sms") return { canal, turnos: [] };

  const inicioHoy = inicioDelDiaMvd(ahora);
  const envios = await prisma.envioSms.findMany({
    where: {
      organizationId,
      motivo: { in: ["recordatorio_turno", "cambio_de_horario"] },
      OR: [
        { programadoEn: { gte: inicioHoy, lte: finDelDiaMvd(ahora) } },
        {
          programadoEn: { lt: inicioHoy },
          OR: [
            { estado: { in: [...ESTADOS_CON_ENVIO_PENDIENTE] } },
            { cerradoEn: { gte: inicioHoy } },
            { aceptadoEn: { gte: inicioHoy } },
          ],
        },
      ],
      paciente: { activo: true },
      turno: { estado: "programado", fecha: { gt: ahora } },
    },
    select: {
      claveIdempotencia: true,
      motivo: true,
      turno: {
        select: {
          id: true,
          fecha: true,
          paciente: { select: { id: true, nombre: true, apellido: true, telefono: true } },
        },
      },
    },
    orderBy: { programadoEn: "asc" },
  });

  const vigentes = envios.flatMap((e) =>
    e.turno && e.claveIdempotencia === claveDelTurno(e.turno.id, e.turno.fecha) ? [{ ...e, turno: e.turno }] : [],
  );

  const telefonos = [...new Set(vigentes.map((e) => e.turno.paciente.telefono.trim()).filter(Boolean))];
  const bajas = new Set(
    telefonos.length === 0
      ? []
      : (await prisma.bajaSms.findMany({ where: { telefono: { in: telefonos } }, select: { telefono: true } })).map(
          (b) => b.telefono,
        ),
  );
  const avisables = vigentes.filter((e) => !bajas.has(e.turno.paciente.telefono.trim()));

  const ultimos = await ultimoAvisoPorTurno(
    prisma,
    organizationId,
    avisables.map((e) => e.turno),
  );

  const turnos: RecordatorioWhatsapp[] = avisables
    .map(({ motivo, turno }) => {
      const { paciente } = turno;
      const telefono = paciente.telefono.trim();
      const enlace = telefono
        ? enlaceWhatsapp(
            telefono,
            textoDelRecordatorio(motivo as "recordatorio_turno" | "cambio_de_horario", configuracion, paciente, turno.fecha),
          )
        : null;
      return {
        turnoId: turno.id,
        fecha: turno.fecha.toISOString(),
        paciente: { id: paciente.id, nombre: paciente.nombre, apellido: paciente.apellido, telefono },
        enlace,
        motivo: enlace ? null : ("sin_telefono" as const),
        avisadoEn: ultimos.get(turno.id) ?? null,
      };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return { canal, turnos };
}

/** Última apertura del enlace de cada turno PARA SU FECHA VIGENTE, en una
 *  consulta: lo abierto antes de mover el turno avisó otro horario. */
async function ultimoAvisoPorTurno(
  prisma: ClientePrisma,
  organizationId: string,
  turnos: ReadonlyArray<{ id: string; fecha: Date }>,
): Promise<Map<string, string>> {
  if (turnos.length === 0) return new Map();
  const filas = await prisma.avisoWhatsapp.groupBy({
    by: ["turnoId"],
    where: {
      organizationId,
      tipo: "recordatorio",
      OR: turnos.map((t) => ({ turnoId: t.id, fechaTurno: t.fecha })),
    },
    _max: { abiertoEn: true },
  });
  const porTurno = new Map<string, string>();
  for (const f of filas) {
    if (f._max.abiertoEn) porTurno.set(f.turnoId, f._max.abiertoEn.toISOString());
  }
  return porTurno;
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
 * el enlace era de otra fecha, el aviso vigente pasa a cambio de horario). Repetir
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
    // Abrió el mensaje de un horario que ya no es el del turno (lo movió
    // entre la lista y el toque): la paciente tiene la hora vieja. Lo mismo
    // que haría reprogramarEnvioDelTurno si esta apertura hubiera llegado
    // antes: el recordatorio vigente, si todavía no salió, pasa a cambio de
    // horario y sale ya.
    if (avisada.getTime() !== turno.fecha.getTime()) {
      // Candidatos: el que espera su hora, o el que el cron ya canceló por
      // el canal (no salió nada). Nunca uno apagado por turno cerrado o baja.
      await tx.envioSms.updateMany({
        where: {
          claveIdempotencia: claveDelTurno(turnoId, turno.fecha),
          motivo: "recordatorio_turno",
          sid: null,
          aceptadoEn: null,
          OR: [{ estado: "pendiente" }, { estado: "cancelado", motivoNoEnvio: MOTIVO_CANAL_WHATSAPP }],
        },
        data: {
          motivo: "cambio_de_horario",
          estado: "pendiente",
          programadoEn: ahora,
          proximoIntentoEn: ahora,
          motivoNoEnvio: null,
          cerradoEn: null,
        },
      });
    }
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
