// Caso de uso: el aviso de cobro a una paciente con sesiones sin cobrar,
// por WhatsApp: la pantalla abre el enlace wa.me con el texto de la plantilla
// y esta request anota que lo abrió.
//
// Lo aprieta ella, una por una, desde Cobros. Nunca sale solo: no hay cron
// que lo dispare ni lote que lo recorra, y es a propósito —un recordatorio de
// plata automático es de una app de cobranzas, no del consultorio.

import type { db } from "@/lib/db";
import { enlaceWhatsapp } from "@/lib/whatsapp";

import { auditar } from "../auditoria";
import { DEUDA_PENDIENTE, deudaDePaciente } from "../domain";
import { requirePaciente } from "../pacientes";
import { ApiError } from "../responses";
import { textoDeCobro } from "./texto-de-cobro";
import { ACCIONES } from "@/lib/auditoria-acciones";

type ClientePrisma = typeof db;

export interface RecordarCobroParams {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  /** Quién apretó el botón: va al evento de auditoría. */
  usuarioId?: string | null;
  ahora?: Date;
}

export interface RecordarCobroResultado {
  /** El mismo enlace que arma la pantalla con enlaceWhatsapp. */
  enlace: string;
  /** Cuándo quedó anotada la apertura: lo que la fila muestra como
   *  "Avisado hace N días". */
  avisadoEn: string;
  sesiones: number;
  monto: number;
}

/**
 * Anota que abrió el aviso de cobro por WhatsApp.
 *
 * Falla con 404 si la paciente no es de la organización, con 409 si no debe
 * nada —no se le avisa a quien no debe: es la única regla que protege a la
 * paciente de recibir un mensaje equivocado— y con 409 si no tiene teléfono.
 */
export async function recordarCobro({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  ahora = new Date(),
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

  return abrirCobroPorWhatsapp({ prisma, organizationId, pacienteId, usuarioId, ahora, telefono, deuda });
}

/**
 * Cuándo abrió por última vez el aviso de cobro de cada paciente por
 * WhatsApp. Una consulta para toda la lista de deudores: sin esto, la
 * pantalla no puede decir "ya le avisaste hace dos días" y el botón invita a
 * repetir.
 *
 * Devuelve un Map pacienteId → ISO; las que nunca recibieron aviso no están.
 */
export async function ultimoAvisoPorPaciente(
  prisma: ClientePrisma,
  organizationId: string,
  pacienteIds: string[],
): Promise<Map<string, string>> {
  if (pacienteIds.length === 0) return new Map();

  const aperturas = await prisma.avisoWhatsapp.findMany({
    where: { organizationId, tipo: "cobro", turno: { pacienteId: { in: pacienteIds } } },
    select: { abiertoEn: true, turno: { select: { pacienteId: true } } },
  });

  const porPaciente = new Map<string, Date>();
  const anotar = (pacienteId: string, cuando: Date | null) => {
    const antes = porPaciente.get(pacienteId);
    if (cuando && (!antes || cuando > antes)) porPaciente.set(pacienteId, cuando);
  };
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
 * Ella abre el enlace (la pantalla lo arma con el mismo enlaceWhatsapp y el
 * mismo texto) y esta request anota que lo abrió: una fila de avisos_whatsapp con tipo
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
}: AbrirCobroParams): Promise<RecordarCobroResultado> {
  const texto = await textoDeCobro(prisma, { organizationId, pacienteId, ahora });
  const enlace = texto === null ? null : enlaceWhatsapp(telefono, texto);
  if (!enlace) {
    throw new ApiError("No se pudo preparar el mensaje", 409);
  }

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
    enlace,
    avisadoEn: ahora.toISOString(),
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
  };
}
