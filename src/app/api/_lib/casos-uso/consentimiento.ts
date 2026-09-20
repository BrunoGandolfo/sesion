// Caso de uso: la autorización de la paciente para grabar sus sesiones.
//
// Estaba entero dentro de la ruta —250 líneas con la transacción de
// revocar-y-crear, la generación del texto y la auditoría— y era una de las
// tres excepciones de rutas-sin-prisma.test.ts. Es la regla más sensible del
// sistema: mientras vivió en la ruta no se pudo probar sin levantarla.
//
// ─── POR QUÉ EL RASTRO VA DENTRO DE LA TRANSACCIÓN ──────────────────────────
//
// Firmar habilita a grabar a una persona y revocar lo deshabilita. Los dos
// son actos legales: hay que poder probar cuándo pasaron y quién los pidió.
// Antes el evento se escribía DESPUÉS del COMMIT y con best-effort, así que
// un fallo entre el COMMIT y esa línea dejaba el acto hecho y sin rastro.
// Ahora el evento entra con `auditar(tx, …)` en la MISMA transacción: o se
// confirman los dos, o no ocurre ninguno.
//
// Del consentimiento sólo entran identificadores y la versión del texto; ni
// el texto completo ni la firma digital (el documento en sí, cifrados en su
// tabla) ni la IP (no se guarda: decisión del dueño).

import {
  buscarConsentimientoVigente,
  esConsentimientoVigente,
  generarTextoConsentimiento,
  sugiereRefirmar,
  type ConsentimientoVigente,
} from "@/lib/consentimiento";
import type { db } from "@/lib/db";
import { cifrarConsentimiento } from "@/lib/prisma-encryption";

import { auditar } from "../auditoria";
import { ApiError } from "../responses";

type ClienteConsentimiento = typeof db;

/** La entidad es la PACIENTE y no la fila del consentimiento: firmar y
 *  revocar quedan así en la misma línea de tiempo, consultable con una sola
 *  query por paciente (revocar lo hace por lote y no tiene un id único que
 *  poner acá). */
const ENTIDAD = "paciente";
export const ACCION_FIRMAR = "consentimiento.firmar";
export const ACCION_REVOCAR = "consentimiento.revocar";

const consentimientoSelect = {
  id: true,
  pacienteId: true,
  firmadoEn: true,
  textoVersion: true,
  revocadoEn: true,
} as const;

export interface ConsentimientoParaLaApp {
  id: string;
  pacienteId: string;
  firmadoEn: Date;
  textoVersion: string;
  vigente: boolean;
  /** La app sugiere firmar el texto vigente; no obliga (decisión del dueño). */
  sugiereRefirmar: boolean;
}

/** La forma que ve la pantalla. `vigente` sale de esConsentimientoVigente,
 *  la misma función que decide si se puede grabar: no se vuelve a escribir
 *  `revocadoEn === null` a mano. */
export function aConsentimientoParaLaApp(
  consentimiento: ConsentimientoVigente,
): ConsentimientoParaLaApp {
  return {
    id: consentimiento.id,
    pacienteId: consentimiento.pacienteId,
    firmadoEn: consentimiento.firmadoEn,
    textoVersion: consentimiento.textoVersion,
    vigente: esConsentimientoVigente(consentimiento),
    sugiereRefirmar: sugiereRefirmar(consentimiento.textoVersion),
  };
}

async function exigirPaciente(
  prisma: Pick<ClienteConsentimiento, "paciente">,
  pacienteId: string,
  organizationId: string,
) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, organizationId },
    select: { id: true, nombre: true, apellido: true },
  });
  if (!paciente) throw new ApiError("Paciente no encontrado", 404);
  return paciente;
}

export interface IdentidadConsentimiento {
  prisma: ClienteConsentimiento;
  organizationId: string;
  pacienteId: string;
}

/** La autorización vigente de la paciente, o null si no firmó o la revocó.
 *  `null` es una respuesta legítima, no un 404. */
export async function obtenerConsentimiento({
  prisma,
  organizationId,
  pacienteId,
}: IdentidadConsentimiento): Promise<ConsentimientoParaLaApp | null> {
  await exigirPaciente(prisma, pacienteId, organizationId);
  const consentimiento = await buscarConsentimientoVigente(
    prisma,
    pacienteId,
    organizationId,
  );
  return consentimiento ? aConsentimientoParaLaApp(consentimiento) : null;
}

export interface FirmarConsentimientoInput extends IdentidadConsentimiento {
  /** Quién resolvió la sesión: va al evento. */
  usuarioId?: string | null;
  firmaDigital: string;
  textoVersion: string;
  ahora?: Date;
}

export interface ConsentimientoFirmado {
  consentimiento: ConsentimientoParaLaApp;
  /** > 0 sólo si ya había una autorización vigente que esta firma reemplazó
   *  (la transacción las revoca antes de crear la nueva). */
  reemplazados: number;
}

export async function firmarConsentimiento({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  firmaDigital,
  textoVersion,
  ahora = new Date(),
}: FirmarConsentimientoInput): Promise<ConsentimientoFirmado> {
  const [paciente, configuracion] = await Promise.all([
    exigirPaciente(prisma, pacienteId, organizationId),
    prisma.configuracion.findUnique({
      where: { organizationId },
      select: { nombreProfesional: true, direccion: true },
    }),
  ]);

  if (!configuracion) {
    throw new ApiError("Configuración de la organización no encontrada", 500);
  }

  const textoCompleto = generarTextoConsentimiento({
    nombrePaciente: `${paciente.nombre} ${paciente.apellido}`.trim(),
    nombreProfesional: configuracion.nombreProfesional,
    direccionConsultorio: configuracion.direccion,
  });

  // El id existe antes del create: el texto y la firma se cifran atados a
  // esta fila (AAD = tabla:columna:id).
  const consentimientoId = crypto.randomUUID();

  return prisma.$transaction(async (tx) => {
    const { count: reemplazados } = await tx.consentimientoGrabacion.updateMany({
      where: { pacienteId, organizationId, revocadoEn: null },
      data: { revocadoEn: ahora },
    });

    const creado = await tx.consentimientoGrabacion.create({
      // cifrarConsentimiento devuelve `{ id, ...columnas cifradas }`: el id
      // lo pone él, porque el AAD del blob lo ata a esta fila.
      data: {
        pacienteId,
        organizationId,
        firmadoEn: ahora,
        textoVersion,
        ...cifrarConsentimiento(consentimientoId, { textoCompleto, firmaDigital }),
      },
      select: consentimientoSelect,
    });

    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      entidad: ENTIDAD,
      entidadId: pacienteId,
      accion: ACCION_FIRMAR,
      creadoEn: ahora,
      detalle: {
        consentimientoId: creado.id,
        textoVersion: creado.textoVersion,
        reemplazados,
      },
    });

    return { consentimiento: aConsentimientoParaLaApp(creado), reemplazados };
  });
}

export interface RevocarConsentimientoInput extends IdentidadConsentimiento {
  usuarioId?: string | null;
  ahora?: Date;
}

/** Revocar es tan sensible como firmar: a partir de acá no se puede grabar
 *  más, y hay que poder probar cuándo dejó de poderse y quién lo pidió. */
export async function revocarConsentimiento({
  prisma,
  organizationId,
  pacienteId,
  usuarioId,
  ahora = new Date(),
}: RevocarConsentimientoInput): Promise<{ revocados: number }> {
  await exigirPaciente(prisma, pacienteId, organizationId);

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.consentimientoGrabacion.updateMany({
      where: { pacienteId, organizationId, revocadoEn: null },
      data: { revocadoEn: ahora },
    });

    if (count === 0) {
      throw new ApiError("Consentimiento vigente no encontrado", 404);
    }

    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId ?? null,
      entidad: ENTIDAD,
      entidadId: pacienteId,
      accion: ACCION_REVOCAR,
      creadoEn: ahora,
      detalle: { revocados: count },
    });

    return { revocados: count };
  });
}
