// Caso de uso: avisarle por SMS a una paciente que tiene sesiones sin cobrar.
//
// Lo aprieta ella, una por una, desde Cobros. Nunca sale solo: no hay cron
// que lo dispare ni lote que lo recorra, y es a propósito —un recordatorio de
// plata automático es de una app de cobranzas, no del consultorio.
//
// Lo que queda del envío es un evento de auditoría, y esa es toda la
// bitácora: no hay tabla nueva. Alcanza porque lo único que hay que poder
// contestar es "¿a esta persona ya le avisé, y cuándo?", y eso es
// exactamente un evento append-only con fecha. El texto del mensaje y el
// teléfono NO se guardan: el registro sirve para saber que pasó, no para
// releer lo que se dijo.
//
// Sin request ni Response: recibe prisma y el enviador como parámetros, igual
// que enviar-recordatorios (así el test le pasa un sendSms de mentira).

import type { db } from "@/lib/db";
import { TEMPLATE_COBRO_DEFAULT, interpolarTemplateCobro } from "@/lib/deudas";
import { money } from "@/lib/format";
import { SMS_NO_ENVIADO } from "@/lib/glosario";
import type { SmsMessage, SmsResult } from "@/lib/recordatorios-sms";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { buscarTurnosConDeuda, calcularDeudores } from "../domain";
import { ApiError } from "../responses";

type ClientePrisma = typeof db;

export type EnviarSms = (mensaje: SmsMessage) => Promise<SmsResult>;

/**
 * Acción del evento que deja un aviso que SALIÓ. Cada fila con esta acción es
 * un SMS que Twilio aceptó: por eso "¿cuándo le avisé por última vez?" es un
 * findFirst por acción y fecha, sin mirar el detalle.
 */
export const ACCION_AVISO = "cobro.recordatorio";

/**
 * Y el que no salió. Es una acción aparte y no un campo dentro del detalle
 * para que el fallo quede en la línea de tiempo —hubo un intento, se puede
 * reconstruir— sin ensuciar la consulta del último aviso efectivo.
 */
export const ACCION_AVISO_FALLIDO = "cobro.recordatorio.fallido";

export interface RecordarCobroParams {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Quién apretó el botón: va al evento de auditoría. */
  usuarioId?: string | null;
  enviarSms: EnviarSms;
  /** Se inyecta, como en aprobar-sesion: el módulo real escribe con el `db`
   *  global y así el caso de uso se puede probar sin él. */
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
  ahora?: Date;
}

export interface RecordarCobroResultado {
  /** Cuándo salió. Es el `ultimoAvisoEn` que va a leer la pantalla. */
  enviadoEn: string;
  sesiones: number;
  monto: number;
  /** El de Twilio, cuando lo devuelve. */
  sid: string | null;
}

/**
 * Arma el aviso de cobro de una paciente y lo manda.
 *
 * Falla con 404 si la paciente no es de la organización, con 409 si no debe
 * nada —no se le avisa a quien no debe: es la única regla que protege a la
 * paciente de recibir un mensaje equivocado— y con 409 si no tiene teléfono.
 * Si Twilio rechaza el envío, sube 502 con SMS_NO_ENVIADO (un texto estable,
 * sin infraestructura adentro) y el motivo real queda en la auditoría y en el
 * log.
 */
export async function recordarCobro({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  enviarSms,
  registrarAuditoria,
  ahora = new Date(),
}: RecordarCobroParams): Promise<RecordarCobroResultado> {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
    select: { id: true, nombre: true, apellido: true, telefono: true },
  });

  if (!paciente) {
    throw new ApiError("Paciente no encontrado", 404);
  }

  // La misma consulta que alimenta /api/deudores, acotada a esta paciente.
  const turnos = await buscarTurnosConDeuda(prisma, organizationId, pacienteId);
  const [deuda] = calcularDeudores(turnos, ahora);

  if (!deuda || deuda.sesionesImpagas === 0) {
    throw new ApiError("Esta paciente no tiene sesiones sin cobrar", 409);
  }

  const telefono = paciente.telefono.trim();
  if (!telefono) {
    throw new ApiError("La paciente no tiene teléfono cargado", 409);
  }

  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId },
    select: { nombreProfesional: true },
  });

  // El mismo texto que la pantalla le mostró antes de que apretara: mismo
  // template, misma interpolación y el mismo money(). Si estas dos cuentas se
  // separan, ella confirma un mensaje y sale otro.
  const texto = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
    nombre: paciente.nombre,
    sesiones: deuda.sesionesImpagas,
    monto: money(deuda.montoTotal),
    profesional: configuracion?.nombreProfesional ?? "",
  });

  const resultado = await enviarSms({ to: telefono, text: texto });

  const detalleComun = {
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
  };

  if (!resultado.success) {
    const motivo = resultado.error ?? "desconocido";

    // El intento fallido también deja rastro: si mañana pregunta por qué no
    // le llegó, la respuesta está acá. Del error va el motivo que devolvió
    // Twilio, que habla de la cuenta y del número, no de la paciente.
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      entidad: "paciente",
      entidadId: pacienteId,
      accion: ACCION_AVISO_FALLIDO,
      detalle: { ...detalleComun, error: motivo },
    });

    // Y al log, que es donde lo va a buscar quien administra el despliegue.
    console.error("[recordar-cobro] el SMS no salió", {
      pacienteId,
      motivo,
    });

    // A la pantalla, en cambio, sube un texto estable. El motivo de sendSms
    // puede ser "SMS no configurado: falta TWILIO_SMS_FROM" —el nombre de una
    // variable de entorno— o un código de la API de Twilio: nada de eso lo
    // puede leer ni arreglar la profesional, y el glosario dice que en
    // pantalla no se nombra la infraestructura. El motivo real no se pierde:
    // quedó en las dos líneas de arriba.
    throw new ApiError(SMS_NO_ENVIADO, 502);
  }

  await registrarAuditoria({
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId ?? null,
    // La entidad es la paciente, como en consentimiento: firmar, revocar y
    // avisar quedan en la misma línea de tiempo, consultable con una query.
    entidad: "paciente",
    entidadId: pacienteId,
    accion: ACCION_AVISO,
    detalle: { ...detalleComun, sid: resultado.sid ?? null },
  });

  return {
    enviadoEn: ahora.toISOString(),
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
    sid: resultado.sid ?? null,
  };
}

/**
 * Cuándo salió el último aviso que SÍ se envió, por paciente. Una sola
 * consulta para toda la lista de deudores: sin esto, la pantalla no puede
 * decir "ya le avisaste hace dos días" y el aviso se manda dos veces.
 *
 * Devuelve un Map pacienteId → ISO; las que nunca recibieron aviso no están.
 */
export async function ultimoAvisoPorPaciente(
  prisma: ClientePrisma,
  organizationId: string,
  pacienteIds: string[],
): Promise<Map<string, string>> {
  if (pacienteIds.length === 0) return new Map();

  const eventos = await prisma.eventoAuditoria.groupBy({
    by: ["entidadId"],
    where: {
      organizationId,
      accion: ACCION_AVISO,
      entidad: "paciente",
      entidadId: { in: pacienteIds },
    },
    _max: { createdAt: true },
  });

  const porPaciente = new Map<string, string>();
  for (const evento of eventos) {
    const cuando = evento._max.createdAt;
    if (cuando) porPaciente.set(evento.entidadId, cuando.toISOString());
  }
  return porPaciente;
}
