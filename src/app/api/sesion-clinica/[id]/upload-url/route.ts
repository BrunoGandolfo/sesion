// Paso 1 de la subida directa a R2 (sin pasar por Vercel).
//
// El navegador ya cifró el audio (AES-256-GCM, clave generada en el
// dispositivo). Acá:
//   1. se guarda clave + IV en datosEstructurados._audioCifradoTemporal
//      (mismo stash que leen /pendientes y /callback: el contrato con el
//      worker no cambia);
//   2. se emite una URL prefirmada PUT de R2 con la key determinística de la
//      sesión, Content-Type y Content-Length firmados, válida 60 min;
//   3. la sesión pasa grabando → subiendo.
// El navegador hace el PUT directo a R2 (paso 2) y después confirma con
// POST [id]/upload-confirmar (paso 3), que verifica con HeadObject.
//
// Reintento: si el PUT o la confirmación fallan, el cliente vuelve la sesión
// a "grabando" (PATCH, transición de cliente permitida) y repite desde acá
// con el mismo blob. Cada llamada emite una URL nueva y re-guarda clave+IV.

import { z } from "zod";
import { db } from "@/lib/db";
import { cifrarSesion } from "@/lib/prisma-encryption";
import { generarUrlSubida, r2Configurado } from "@/lib/r2";
import { keyAudioEsperada } from "@/lib/sesion-clinica-utils";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";
import {
  assertTransicionValida,
  conClaveTemporal,
} from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Sin tope de 120 MB (era el límite del buffer en memoria de la función).
// Queda solo una cota de sanidad: 2 GiB, muy por encima de una sesión de
// 90 min en Opus (~40-60 MB).
const MAX_TAMANO_BYTES = 2 * 1024 * 1024 * 1024;
const EXPIRA_EN_SEGUNDOS = 60 * 60;
const MIME_DEFAULT = "application/octet-stream";

const bodySchema = z.object({
  claveCifrado: z.string().trim().min(1, "Falta la clave de cifrado"),
  iv: z.string().trim().min(1, "Falta el IV de cifrado"),
  tamanoBytes: z
    .number()
    .int("El tamaño debe ser un entero")
    .positive("El tamaño debe ser mayor a cero")
    .max(MAX_TAMANO_BYTES, "El audio supera el tamaño máximo admitido"),
  mime: z.string().trim().min(1).max(100).default(MIME_DEFAULT),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const sesion = await db.sesionClinica.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        estado: true,
        turnoId: true,
        datosEstructurados: true,
      },
    });

    if (!sesion) {
      throw new ApiError("Sesión clínica no encontrada", 404);
    }

    if (sesion.estado !== "grabando") {
      throw new ApiError(
        sesion.estado === "subiendo"
          ? "La sesión ya tiene una subida en curso. Para reintentar, volvé la sesión a 'grabando' y pedí una URL nueva."
          : `Solo se puede iniciar la subida desde una sesión en estado grabando (estado actual: ${sesion.estado})`,
        409,
      );
    }
    assertTransicionValida(sesion.estado, "subiendo");

    if (!r2Configurado()) {
      // Sin R2 no hay dónde subir: no existe más el modo "dev-no-r2".
      throw new ApiError(
        "El almacenamiento de audio (R2) no está configurado en este entorno",
        503,
      );
    }

    const key = keyAudioEsperada(organizationId, sesion.id, sesion.turnoId);

    // La URL se genera ANTES de tocar la fila: si R2 falla, la sesión sigue
    // en grabando y el cliente puede reintentar sin PATCH.
    const { url, expiraEn } = await generarUrlSubida(key, {
      contentType: parsed.data.mime,
      contentLength: parsed.data.tamanoBytes,
      expiraEnSegundos: EXPIRA_EN_SEGUNDOS,
    });

    // updateMany con la organización y el estado leído en el WHERE.
    // `update({ where: { id } })` escribe la fila aunque sea de otra
    // organización, y entre el findFirst de arriba y esta línea hay una
    // ventana: acá encima esa ventana la abre una llamada a R2, que puede
    // tardar. El estado se conserva como condición para que dos pestañas
    // pidiendo URL a la vez no se pisen la clave de cifrado.
    const { count } = await db.sesionClinica.updateMany({
      where: { id: sesion.id, organizationId, estado: "grabando" },
      data: {
        estado: "subiendo",
        error: null,
        ...cifrarSesion({
          datosEstructurados: conClaveTemporal(
            sesion.datosEstructurados,
            parsed.data.claveCifrado,
            parsed.data.iv,
          ),
        }),
      },
    });

    if (count === 0) {
      throw new ApiError(
        "La sesión cambió mientras se preparaba la subida. Probá de nuevo.",
        409,
      );
    }

    await registrarAuditoria({
      organizationId,
      actorTipo: "usuario",
      actorId: userId,
      accion: "sesion.subir_audio_inicio",
      entidad: "sesion_clinica",
      entidadId: sesion.id,
      detalle: {
        tamanoBytes: parsed.data.tamanoBytes,
        mime: parsed.data.mime,
        expiraEnSegundos: EXPIRA_EN_SEGUNDOS,
      },
    });

    return ok({
      url,
      key,
      expiraEn: expiraEn.toISOString(),
      // El navegador DEBE mandar exactamente estos headers en el PUT: están
      // firmados en la URL.
      headers: { "Content-Type": parsed.data.mime },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
