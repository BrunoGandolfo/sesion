import { z } from "zod";
import { db } from "@/lib/db";
import { RECORDATORIO_MODOS } from "@/lib/recordatorios-programacion";

import { getOrganizationId } from "../_lib/auth";
import { toConfiguracion } from "../_lib/domain";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

// ────────────────────────────────────────────────────────────────────────────
// `horasAnticipacion` NO está acá, y es a propósito.
//
// Era el número de horas de antelación del recordatorio. Dejó de decidir nada
// cuando el recordatorio pasó a guardarse como un MOMENTO
// (`recordatorioModo`: día anterior / dos días antes / misma mañana, ver
// src/lib/recordatorios-programacion.ts). Se había quedado en el schema "por
// compatibilidad", y eso es peor que sacarlo: el PATCH lo aceptaba y lo
// escribía en la columna, así que un cliente que lo mandara recibía un 200 y
// se iba convencido de haber cambiado cuándo le llega el SMS a la paciente.
// Un contrato que contesta que sí a algo que no hace es una mentira, no una
// compatibilidad.
//
// Como zod ignora las claves que el objeto no declara, mandarlo ahora no
// rompe: se descarta en silencio y el resto del cuerpo se guarda igual.
//
// La COLUMNA sigue existiendo en la base con su default, porque sacarla es
// una migración y las migraciones no entran en esta tanda. Cuando se haga,
// se va con ella la última referencia.
// ────────────────────────────────────────────────────────────────────────────

const updateConfigSchema = z.object({
  nombreProfesional: z.string().trim().min(1, "Falta el nombre").optional(),
  direccion: z.string().trim().optional(),
  whatsappOrigen: z.string().trim().optional(),
  tarifaDefault: z
    .number()
    .int()
    .min(0, "La tarifa no puede ser negativa")
    .optional(),
  /** Cuándo sale el recordatorio. Ver src/lib/recordatorios-programacion.ts. */
  recordatorioModo: z.enum(RECORDATORIO_MODOS).optional(),
  templateRecordatorio: z
    .string()
    .trim()
    .min(1, "Falta el template")
    .optional(),
  orientacionTeorica: z.enum(["cbt_mi", "gestalt"]).optional(),
});

export async function GET() {
  try {
    const organizationId = await getOrganizationId();

    const configuracion = await db.configuracion.findUnique({
      where: { organizationId },
    });

    if (!configuracion) {
      throw new ApiError("Configuración no encontrada", 404);
    }

    return ok(toConfiguracion(configuracion));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body = await request.json();
    const parsed = updateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await db.configuracion.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new ApiError("Configuración no encontrada", 404);
    }

    const configuracion = await db.configuracion.update({
      where: { organizationId },
      data: parsed.data,
    });

    return ok(toConfiguracion(configuracion));
  } catch (error) {
    return errorResponse(error);
  }
}
