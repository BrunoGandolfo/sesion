// Caso de uso: pedir el aviso de cobro a una paciente con sesiones sin
// cobrar, por el canal de Tu consultorio (accionDeCobro, src/lib/aviso-cobro.ts):
// por SMS (lo de abajo) o, con "WhatsApp desde mi teléfono", con el enlace
// wa.me que ella abre (al final de este archivo).
//
// Lo aprieta ella, una por una, desde Cobros. Nunca sale solo: no hay cron
// que lo dispare ni lote que lo recorra, y es a propósito —un recordatorio de
// plata automático es de una app de cobranzas, no del consultorio.
//
// ─── ACÁ NO SE MANDA NADA: SE CREA EL ENVÍO ─────────────────────────────────
//
// Antes el SMS salía en esta misma request y se auditaba después: si Twilio
// aceptaba y la auditoría fallaba, la pantalla mostraba un error y ella
// volvía a apretar (U4 en su forma sincrónica: dos mensajes). Ahora acá sólo
// se CREA la fila en envios_sms (motivo recordatorio_cobro) y la manda el
// cron de despacho (casos-uso/despachar-sms.ts), que arma el texto en ese
// momento con la deuda vigente y respeta la baja, el backoff y todo lo demás
// que vale para cualquier SMS.
//
// La clave de idempotencia `cobro:<paciente>:<día de Montevideo>` garantiza
// UN aviso por paciente y por día: dos toques seguidos, dos pestañas o un
// reintento del POST devuelven la misma fila (`creado: false`) sin crear
// otra.
//
// El rastro del envío es la fila, con su estado real (aceptado, entregado,
// no entregado…). El evento de auditoría queda para lo único que la fila no
// dice: QUIÉN lo pidió. Ni el texto ni el teléfono entran al evento.

import { accionDeCobro } from "@/lib/aviso-cobro";
import { COBRO_CANAL_CAMBIO, MOTIVO_PACIENTE_DADA_DE_BAJA } from "@/lib/glosario";
import type { db } from "@/lib/db";
import { CANAL_RECORDATORIO_VIGENTE } from "@/lib/recordatorios-programacion";

import { auditar, registrarAuditoria } from "../auditoria";
import { DEUDA_PENDIENTE, deudaDePaciente } from "../domain";
import { requirePaciente } from "../pacientes";
import { ApiError } from "../responses";
import { programarEnvioDeCobro } from "./envios-del-turno";
import { textoDeCobro } from "./texto-de-cobro";
import { ACCIONES } from "@/lib/auditoria-acciones";

type ClientePrisma = typeof db;

/**
 * Acción del evento que deja un aviso PEDIDO. Una fila por toque efectivo
 * (el segundo del mismo día no crea evento porque no crea envío).
 */

export interface RecordarCobroParams {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Quién apretó el botón: va al evento de auditoría. */
  usuarioId?: string | null;
  ahora?: Date;
  /** El canal que usó la pantalla. Si no es el de la base, 409 sin efectos:
   *  si no, quedaría anotado un WhatsApp que no se abrió, o saldría un SMS
   *  además del WhatsApp. Sin él es la pantalla de antes de elegir canal,
   *  que pedía SMS: también 409. */
  canal?: "sms" | "whatsapp";
}

export type RecordarCobroResultado = RecordarCobroPorSms | RecordarCobroPorWhatsapp;

export interface RecordarCobroPorWhatsapp {
  canal: "whatsapp";
  /** El mismo enlace que arma la pantalla con accionDeCobro. */
  enlace: string;
  /** Cuándo quedó anotada la apertura: lo que la fila muestra como
   *  "Avisado hace N días". */
  avisadoEn: string;
  sesiones: number;
  monto: number;
}

export interface RecordarCobroPorSms {
  canal: "sms";
  /** La fila de envios_sms: la pantalla puede leer su estado real. */
  envioId: string;
  /** false si ya había un aviso pedido hoy para esta paciente. */
  creado: boolean;
  /** Cuándo entró a la cola (sale en el próximo tick del cron, ≤ 5 min). */
  programadoEn: string;
  sesiones: number;
  monto: number;
}


/**
 * Valida y crea el envío del aviso de cobro.
 *
 * Falla con 404 si la paciente no es de la organización, con 409 si no debe
 * nada —no se le avisa a quien no debe: es la única regla que protege a la
 * paciente de recibir un mensaje equivocado—, con 409 si no tiene teléfono y
 * con 409 si ese teléfono pidió no recibir más mensajes (el despachador lo
 * cancelaría igual, pero decirlo ahora evita que ella espere un aviso que no
 * va a salir).
 */
export async function recordarCobro({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  ahora = new Date(),
  canal,
}: RecordarCobroParams): Promise<RecordarCobroResultado> {
  const paciente = await requirePaciente(prisma, pacienteId, organizationId, { id: true, telefono: true });

  // La misma cuenta que /api/deudores, acotada a esta paciente.
  const deuda = await deudaDePaciente(prisma, organizationId, pacienteId, ahora);

  if (!deuda) {
    throw new ApiError("Esta paciente no tiene sesiones sin cobrar", 409);
  }

  const telefono = paciente.telefono.trim();
  if (!telefono) {
    throw new ApiError("La paciente no tiene teléfono cargado", 409);
  }

  // La baja vale también para el WhatsApp, como en el recordatorio de turno
  // (recordatorios-whatsapp.ts): pidió no recibir más mensajes.
  const baja = await prisma.bajaSms.findUnique({ where: { telefono }, select: { telefono: true } });
  if (baja) {
    throw new ApiError(MOTIVO_PACIENTE_DADA_DE_BAJA, 409);
  }

  // Sólo WhatsApp (CANAL_RECORDATORIO_VIGENTE): lo guardado en la columna no
  // cuenta. Una pantalla vieja que pida SMS recibe el 409 de canal cambiado,
  // también la de antes de elegir canal, que manda `{}`: si no, se anotaría
  // una apertura de WhatsApp que esa pantalla nunca hizo.
  const canalVigente = CANAL_RECORDATORIO_VIGENTE === "whatsapp" ? "whatsapp" : "sms";
  if ((canal ?? "sms") !== canalVigente) {
    throw new ApiError(COBRO_CANAL_CAMBIO, 409);
  }
  if (canalVigente === "whatsapp") {
    return abrirCobroPorWhatsapp({ prisma, organizationId, pacienteId, usuarioId, ahora, telefono, deuda });
  }

  const { envioId, creado } = await programarEnvioDeCobro(prisma, { organizationId, pacienteId, ahora });

  if (creado) {
    await registrarAuditoria(prisma, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      // La entidad es la paciente, como en consentimiento: firmar, revocar y
      // avisar quedan en la misma línea de tiempo, consultable con una query.
      entidad: "paciente",
      entidadId: pacienteId,
      accion: ACCIONES.cobro.recordatorio,
      detalle: { sesiones: deuda.sesionesImpagas, monto: deuda.montoTotal, envioId },
    });
  }

  return {
    canal: "sms",
    envioId,
    creado,
    programadoEn: ahora.toISOString(),
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
  };
}

/**
 * Cuándo SALIÓ el último aviso de cobro de cada paciente (Twilio lo aceptó:
 * `aceptadoEn`, en estado aceptado o entregado; uno que el operador no
 * entregó no cuenta como aviso) o, por WhatsApp, cuándo abrió el enlace por
 * última vez. Gana el más nuevo de los dos, sea cual sea el canal de hoy:
 * si cambió de canal, la paciente igual ya recibió el aviso. Una consulta por
 * canal para toda la lista de deudores: sin esto, la pantalla no puede decir
 * "ya le avisaste hace dos días" y el botón invita a repetir.
 *
 * Devuelve un Map pacienteId → ISO; las que nunca recibieron aviso no están.
 */
export async function ultimoAvisoPorPaciente(
  prisma: ClientePrisma,
  organizationId: string,
  pacienteIds: string[],
): Promise<Map<string, string>> {
  if (pacienteIds.length === 0) return new Map();

  const [envios, aperturas] = await Promise.all([prisma.envioSms.groupBy({
    by: ["pacienteId"],
    where: {
      organizationId,
      motivo: "recordatorio_cobro",
      estado: { in: ["aceptado", "entregado"] },
      pacienteId: { in: pacienteIds },
      aceptadoEn: { not: null },
    },
    _max: { aceptadoEn: true },
  }),
  prisma.avisoWhatsapp.findMany({
    where: { organizationId, tipo: "cobro", turno: { pacienteId: { in: pacienteIds } } },
    select: { abiertoEn: true, turno: { select: { pacienteId: true } } },
  })]);

  const porPaciente = new Map<string, Date>();
  const anotar = (pacienteId: string, cuando: Date | null) => {
    const antes = porPaciente.get(pacienteId);
    if (cuando && (!antes || cuando > antes)) porPaciente.set(pacienteId, cuando);
  };
  for (const envio of envios) anotar(envio.pacienteId, envio._max.aceptadoEn);
  for (const apertura of aperturas) anotar(apertura.turno.pacienteId, apertura.abiertoEn);
  return new Map([...porPaciente].map(([id, cuando]) => [id, cuando.toISOString()]));
}

interface AbrirCobroParams {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  usuarioId?: string | null;
  ahora: Date;
  telefono: string;
  deuda: { sesionesImpagas: number; montoTotal: number };
}

/**
 * Con "WhatsApp desde mi teléfono": no se programa ningún SMS. Ella abre el
 * enlace (la pantalla lo arma con la misma accionDeCobro y el mismo texto) y
 * esta request anota que lo abrió: una fila de avisos_whatsapp con tipo
 * `cobro` y su evento, en la misma transacción. Abrir dos veces son dos
 * filas, como en el recordatorio de turno: la app no sabe si el mensaje
 * salió, sabe que lo abrió.
 *
 * La fila cuelga del turno impago más viejo (avisos_whatsapp exige un
 * turno): es la deuda que se avisó, y por él se llega a la paciente.
 */
async function abrirCobroPorWhatsapp({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  ahora,
  telefono,
  deuda,
}: AbrirCobroParams): Promise<RecordarCobroPorWhatsapp> {
  const texto = await textoDeCobro(prisma, { organizationId, pacienteId, ahora });
  const accion = texto === null ? null : accionDeCobro("whatsapp", telefono, texto);
  if (!accion || accion.canal !== "whatsapp" || !accion.enlace) {
    throw new ApiError("No se pudo preparar el mensaje", 409);
  }
  const enlace = accion.enlace;

  await prisma.$transaction(async (tx) => {
    const turno = await tx.turno.findFirst({
      where: { organizationId, pacienteId, ...DEUDA_PENDIENTE },
      orderBy: { fecha: "asc" },
      select: { id: true, fecha: true },
    });
    if (!turno) throw new ApiError("Esta paciente no tiene sesiones sin cobrar", 409);
    const aviso = await tx.avisoWhatsapp.create({
      data: {
        organizationId,
        turnoId: turno.id,
        tipo: "cobro",
        fechaTurno: turno.fecha,
        abiertoEn: ahora,
        usuarioId: usuarioId ?? "",
      },
      select: { id: true },
    });
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      entidad: "paciente",
      entidadId: pacienteId,
      accion: ACCIONES.cobro.whatsappAbierto,
      detalle: { canal: "whatsapp", avisoId: aviso.id, sesiones: deuda.sesionesImpagas, monto: deuda.montoTotal },
    });
  });

  return {
    canal: "whatsapp",
    enlace,
    avisadoEn: ahora.toISOString(),
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
  };
}
