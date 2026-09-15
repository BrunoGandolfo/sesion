// Caso de uso: pedir el aviso de cobro por SMS a una paciente con sesiones
// sin cobrar.
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

import { MOTIVO_PACIENTE_DADA_DE_BAJA } from "@/lib/glosario";
import type { db } from "@/lib/db";

import type { EventoAuditoriaInput } from "../auditoria-pura";
import { buscarTurnosConDeuda, calcularDeudores } from "../domain";
import { ApiError } from "../responses";
import { programarEnvioDeCobro } from "./envios-del-turno";

type ClientePrisma = typeof db;

/**
 * Acción del evento que deja un aviso PEDIDO. Una fila por toque efectivo
 * (el segundo del mismo día no crea evento porque no crea envío).
 */
export const ACCION_AVISO = "cobro.recordatorio";

export interface RecordarCobroParams {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Quién apretó el botón: va al evento de auditoría. */
  usuarioId?: string | null;
  /** Se inyecta, como en aprobar-sesion: el módulo real escribe con el `db`
   *  global y así el caso de uso se puede probar sin él. */
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
  ahora?: Date;
}

export interface RecordarCobroResultado {
  /** La fila de envios_sms: la pantalla puede leer su estado real. */
  envioId: string;
  /** false si ya había un aviso pedido hoy para esta paciente. */
  creado: boolean;
  /** Cuándo entró a la cola (sale en el próximo tick del cron, ≤ 5 min). */
  programadoEn: string;
  sesiones: number;
  monto: number;
}

export { MOTIVO_PACIENTE_DADA_DE_BAJA } from "@/lib/glosario";

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
  registrarAuditoria,
  ahora = new Date(),
}: RecordarCobroParams): Promise<RecordarCobroResultado> {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
    select: { id: true, telefono: true },
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

  const baja = await prisma.bajaSms.findUnique({ where: { telefono }, select: { telefono: true } });
  if (baja) {
    throw new ApiError(MOTIVO_PACIENTE_DADA_DE_BAJA, 409);
  }

  const { envioId, creado } = await programarEnvioDeCobro(prisma, { organizationId, pacienteId, ahora });

  if (creado) {
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      // La entidad es la paciente, como en consentimiento: firmar, revocar y
      // avisar quedan en la misma línea de tiempo, consultable con una query.
      entidad: "paciente",
      entidadId: pacienteId,
      accion: ACCION_AVISO,
      detalle: { sesiones: deuda.sesionesImpagas, monto: deuda.montoTotal, envioId },
    });
  }

  return {
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
 * entregó no cuenta como aviso). Una sola consulta para toda la lista de
 * deudores: sin esto, la pantalla no puede decir "ya le avisaste hace dos
 * días" y el botón invita a repetir.
 *
 * Devuelve un Map pacienteId → ISO; las que nunca recibieron aviso no están.
 */
export async function ultimoAvisoPorPaciente(
  prisma: ClientePrisma,
  organizationId: string,
  pacienteIds: string[],
): Promise<Map<string, string>> {
  if (pacienteIds.length === 0) return new Map();

  const envios = await prisma.envioSms.groupBy({
    by: ["pacienteId"],
    where: {
      organizationId,
      motivo: "recordatorio_cobro",
      estado: { in: ["aceptado", "entregado"] },
      pacienteId: { in: pacienteIds },
      aceptadoEn: { not: null },
    },
    _max: { aceptadoEn: true },
  });

  const porPaciente = new Map<string, string>();
  for (const envio of envios) {
    const cuando = envio._max.aceptadoEn;
    if (cuando) porPaciente.set(envio.pacienteId, cuando.toISOString());
  }
  return porPaciente;
}
