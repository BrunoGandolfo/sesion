import { okSinCache } from "@/app/api/_lib/responses";
import { VERSION_APP } from "@/lib/version-app";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Metadato público del build. Sin datos de cuenta ni consultas a la base. */
export function GET() {
  return okSinCache({ version: VERSION_APP });
}
