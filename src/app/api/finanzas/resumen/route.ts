// GET /api/finanzas/resumen — el tablero de Finanzas, ya calculado.
//
// Parámetros, todos opcionales:
//   desde, hasta   "AAAA-MM". Por defecto, los últimos doce meses hasta hoy.
//   granularidad   "mes" | "anio". Sin esto la elige el servidor por el largo
//                  del período (hasta 24 meses, meses; más, años).
//
// El DETALLE de un período no vive acá: al tocar una barra, la pantalla pide
// lo que ya existe —GET /api/turnos?desde&hasta para las sesiones trabajadas
// y GET /api/turnos/cobros para las cobradas de ese mes—. Ver
// docs/contrato-finanzas.md.

import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import {
  GRANULARIDADES,
  parsearMes,
  resumenFinanzas,
  type Granularidad,
} from "../../_lib/casos-uso/finanzas";
import { ApiError, errorResponse, ok } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

function granularidadDe(crudo: string | null): Granularidad | undefined {
  if (crudo === null) return undefined;
  if ((GRANULARIDADES as readonly string[]).includes(crudo)) {
    return crudo as Granularidad;
  }
  throw new ApiError(
    `Granularidad inválida: ${crudo} (se espera ${GRANULARIDADES.join(" o ")})`,
    400,
  );
}

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const query = new URL(request.url).searchParams;
    const desde = query.get("desde");
    const hasta = query.get("hasta");

    return ok(
      await resumenFinanzas({
        prisma: db,
        organizationId,
        ...(desde ? { desde: parsearMes(desde) } : {}),
        ...(hasta ? { hasta: parsearMes(hasta) } : {}),
        ...(granularidadDe(query.get("granularidad")) !== undefined
          ? { granularidad: granularidadDe(query.get("granularidad")) }
          : {}),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
