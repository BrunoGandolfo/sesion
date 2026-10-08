import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { listarRecordatoriosDeHoy } from "../../_lib/casos-uso/recordatorios-whatsapp";
import { errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

/** Los recordatorios de hoy con su enlace de WhatsApp. Con canal `sms`,
 *  `turnos: []`: la pantalla decide si muestra el bloque. */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    return ok(await listarRecordatoriosDeHoy({ prisma: db, organizationId, ahora: new Date() }));
  } catch (error) {
    return errorResponse(error);
  }
}
