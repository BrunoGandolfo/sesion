import { z } from "zod";
import { db } from "@/lib/db";
import {
  buscarConsentimientoVigente,
  generarTextoConsentimiento,
} from "@/lib/consentimiento";
import { ipDeRequest } from "@/lib/request-huella";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getOrganizationId, getSessionActor } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ConsentimientoResponseInput = {
  id: string;
  pacienteId: string;
  firmadoEn: Date;
  textoVersion: string;
  revocadoEn: Date | null;
};

const createConsentimientoSchema = z.object({
  firmaDigital: z.string().trim().min(1, "Falta la firma digital"),
  textoVersion: z.string().trim().min(1, "Falta la versión del texto"),
});

const consentimientoSelect = {
  id: true,
  pacienteId: true,
  firmadoEn: true,
  textoVersion: true,
  revocadoEn: true,
} as const;

function toConsentimientoResponse(consentimiento: ConsentimientoResponseInput) {
  return {
    id: consentimiento.id,
    pacienteId: consentimiento.pacienteId,
    firmadoEn: consentimiento.firmadoEn,
    textoVersion: consentimiento.textoVersion,
    vigente: consentimiento.revocadoEn === null,
  };
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("JSON inválido", 400);
  }
}

async function assertPacienteExists(id: string, organizationId: string) {
  const paciente = await db.paciente.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });

  if (!paciente) {
    throw new ApiError("Paciente no encontrado", 404);
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    const consentimiento = await buscarConsentimientoVigente(
      db,
      id,
      organizationId,
    );

    // Envoltorio único de la API: { data: { consentimiento } }. `null` es
    // una respuesta legítima —la paciente no firmó—, no un 404.
    if (!consentimiento) {
      return ok({ consentimiento: null });
    }

    return ok({
      consentimiento: toConsentimientoResponse(consentimiento),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    // getSessionActor y no getOrganizationId: la auditoría necesita saber
    // QUIÉN firmó, y esta es la única forma de tener el userId con una sola
    // resolución de sesión (igual que la ruta de documentación).
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const body = await parseJsonBody(request);
    const parsed = createConsentimientoSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const [paciente, configuracion] = await Promise.all([
      db.paciente.findFirst({
        where: { id, organizationId },
        select: { id: true, nombre: true, apellido: true },
      }),
      db.configuracion.findUnique({
        where: { organizationId },
        select: { nombreProfesional: true, direccion: true },
      }),
    ]);

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    if (!configuracion) {
      throw new ApiError("Configuración de la organización no encontrada", 500);
    }

    const textoCompleto = generarTextoConsentimiento({
      nombrePaciente: `${paciente.nombre} ${paciente.apellido}`.trim(),
      nombreProfesional: configuracion.nombreProfesional,
      direccionConsultorio: configuracion.direccion,
    });

    const ipOrigen = ipDeRequest(request);
    const now = new Date();

    const { consentimiento, reemplazados } = await db.$transaction(async (tx) => {
      const { count } = await tx.consentimientoGrabacion.updateMany({
        where: {
          pacienteId: id,
          organizationId,
          revocadoEn: null,
        },
        data: { revocadoEn: now },
      });

      const creado = await tx.consentimientoGrabacion.create({
        data: {
          pacienteId: id,
          organizationId,
          firmadoEn: now,
          textoVersion: parsed.data.textoVersion,
          textoCompleto,
          firmaDigital: parsed.data.firmaDigital,
          ipOrigen,
        },
        select: consentimientoSelect,
      });

      return { consentimiento: creado, reemplazados: count };
    });

    // El acto que habilita a grabar a una persona: va al registro append-only
    // sí o sí. Del consentimiento sólo entran identificadores, la versión del
    // texto y desde dónde se firmó; ni el texto completo ni la firma digital,
    // que son el documento en sí y viven en su propia tabla.
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      // La entidad es la paciente y no la fila del consentimiento: firmar y
      // revocar quedan así en la misma línea de tiempo, consultable con una
      // sola query por paciente (el DELETE revoca por lote y no tiene un id
      // único que poner acá).
      entidad: "paciente",
      entidadId: id,
      accion: "consentimiento.firmar",
      detalle: {
        consentimientoId: consentimiento.id,
        textoVersion: consentimiento.textoVersion,
        // > 0 sólo si ya había una autorización vigente que esta firma
        // reemplazó (la transacción las revoca antes de crear la nueva).
        reemplazados,
        ip: ipOrigen,
      },
    });

    // Mismo envoltorio que el GET: { data: { consentimiento } }. Antes salía
    // sin `data` y el cliente de API, que desenvuelve siempre, entregaba
    // undefined; ninguno de los dos consumidores lee el cuerpo, así que el
    // contrato roto no se notaba.
    return ok({ consentimiento: toConsentimientoResponse(consentimiento) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    await assertPacienteExists(id, organizationId);

    const { count } = await db.consentimientoGrabacion.updateMany({
      where: {
        pacienteId: id,
        organizationId,
        revocadoEn: null,
      },
      data: { revocadoEn: new Date() },
    });

    if (count === 0) {
      throw new ApiError("Consentimiento vigente no encontrado", 404);
    }

    // Revocar es tan sensible como firmar: a partir de acá no se puede grabar
    // más, y hay que poder probar cuándo dejó de poderse y quién lo pidió.
    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      entidad: "paciente",
      entidadId: id,
      accion: "consentimiento.revocar",
      detalle: { revocados: count, ip: ipDeRequest(request) },
    });

    // { data: { revocados } }: el mismo envoltorio que el GET y el POST.
    return ok({ revocados: count });
  } catch (error) {
    return errorResponse(error);
  }
}
