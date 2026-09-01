import { Buffer } from "node:buffer";

import { z } from "zod";
import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";
import {
  assertTransicionValida,
  sinClaveTemporal,
} from "../../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type EstadoUpload = "grabando" | "subiendo";

type R2Module = {
  r2Configurado: () => boolean;
  subirAudioCifrado: (
    key: string,
    data: Buffer,
    metadata: { iv: string; claveId: string },
  ) => Promise<string>;
};

const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const estadosPermitidos = new Set<EstadoUpload>(["grabando", "subiendo"]);

const uploadSchema = z.object({
  iv: z.string().trim().min(1, "Falta el IV de cifrado"),
  claveCifrado: z.string().trim().min(1, "Falta la clave de cifrado"),
  duracionSegundos: z.coerce
    .number()
    .int("La duración debe ser un número entero")
    .nonnegative("La duración no puede ser negativa"),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isR2Module(value: unknown): value is R2Module {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.r2Configurado === "function" &&
    typeof value.subirAudioCifrado === "function"
  );
}

async function getR2Module(): Promise<R2Module | null> {
  try {
    const mod: unknown = await import("@/lib/r2");
    return isR2Module(mod) ? mod : null;
  } catch (error) {
    console.warn(
      "[sesion-clinica/upload] No se pudo cargar @/lib/r2; se continúa sin subida real.",
      error,
    );
    return null;
  }
}

function construirMetadataTemporal(
  datosEstructuradosActuales: unknown,
  claveCifrado: string,
  iv: string,
) {
  let metadataActual: Record<string, unknown> = {};

  if (datosEstructuradosActuales != null) {
    try {
      const parsed: unknown =
        typeof datosEstructuradosActuales === "string"
          ? JSON.parse(datosEstructuradosActuales)
          : datosEstructuradosActuales;
      if (isPlainObject(parsed)) {
        metadataActual = parsed;
      }
    } catch {
      metadataActual = {};
    }
  }

  return JSON.stringify({
    ...metadataActual,
    // TODO: mover clave + IV a un vault seguro. Esto es temporal para desarrollo.
    _audioCifradoTemporal: {
      claveCifrado,
      ivCifrado: iv,
      guardadoEn: "datosEstructurados",
      actualizadoEn: new Date().toISOString(),
    },
  });
}

async function parseFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw new ApiError("No se pudo leer el formulario enviado", 400);
  }
}

function getAudioFile(formData: FormData) {
  const audio = formData.get("audio");

  if (!audio || typeof audio === "string") {
    throw new ApiError("Falta el archivo de audio", 400);
  }

  if (audio.size === 0) {
    throw new ApiError("El archivo de audio está vacío", 400);
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    throw new ApiError("El archivo de audio supera el límite de 120 MB", 400);
  }

  return audio;
}

function assertEstadoPermitido(estado: string): asserts estado is EstadoUpload {
  if (!estadosPermitidos.has(estado as EstadoUpload)) {
    throw new ApiError(
      "Solo se puede subir audio desde una sesión en estado grabando o subiendo",
      400,
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

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

    assertEstadoPermitido(sesion.estado);

    const formData = await parseFormData(request);
    const audioFile = getAudioFile(formData);
    const parsed = uploadSchema.safeParse({
      iv: formData.get("iv"),
      claveCifrado: formData.get("claveCifrado"),
      duracionSegundos: formData.get("duracionSegundos"),
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    let audioR2Key = "dev-no-r2";
    const r2 = await getR2Module();

    if (r2?.r2Configurado()) {
      const key = `audio/${organizationId}/${sesion.id}/${sesion.turnoId}.enc`;
      audioR2Key = await r2.subirAudioCifrado(key, audioBuffer, {
        iv: parsed.data.iv,
        claveId: sesion.id,
      });
    } else {
      console.warn(
        "[sesion-clinica/upload] R2 no configurado o no disponible; se omite la subida real.",
        { sesionClinicaId: sesion.id, organizationId },
      );
    }

    // Tabla única de transiciones (grabando|subiendo → procesando).
    assertTransicionValida(sesion.estado, "procesando");

    const actualizada = await db.sesionClinica.update({
      where: { id: sesion.id },
      data: {
        estado: "procesando",
        duracionAudioSeg: parsed.data.duracionSegundos,
        audioR2Key,
        error: null,
        datosEstructurados: construirMetadataTemporal(
          sesion.datosEstructurados,
          parsed.data.claveCifrado,
          parsed.data.iv,
        ),
      },
    });

    // La clave temporal del audio recién guardada no vuelve al cliente.
    return ok(sinClaveTemporal(actualizada));
  } catch (error) {
    return errorResponse(error);
  }
}
