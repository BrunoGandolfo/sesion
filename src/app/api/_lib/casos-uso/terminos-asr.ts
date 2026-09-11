// Caso de uso: los términos de vocabulario clínico que el ASR tiene que
// escuchar en una sesión de esta paciente.
//
// La regla —lo global y lo de la profesional siempre, más lo propio de esa
// paciente, todo activo, deduplicado y ordenado— vivía escrita dentro de
// GET /api/hot-words/paciente/[pacienteId], una ruta sin ningún cliente que
// se borró en la reconstrucción. Hoy la lee reclamar-pendientes (que la manda
// al worker dentro de cada sesión reclamada). Si mañana se agrega un scope o
// se decide que los inactivos cuentan, se toca acá.
//
// Sin request ni Response: recibe prisma como parámetro.

import type { db } from "@/lib/db";

type ClientePrisma = typeof db;

export interface TerminosAsrParams {
  prisma: ClientePrisma;
  organizationId: string;
  /** La paciente de la sesión: suma sus términos de scope "paciente". */
  pacienteId: string;
}

/**
 * Términos activos que aplican a una sesión de esa paciente: los de scope
 * "global" y "profesional" de la organización, más los de scope "paciente"
 * de esa paciente. Sin repetidos, ordenados, `[]` si no hay ninguno.
 */
export async function terminosAsr({
  prisma,
  organizationId,
  pacienteId,
}: TerminosAsrParams): Promise<string[]> {
  const hotWords = await prisma.hotWord.findMany({
    where: {
      organizationId,
      activo: true,
      OR: [
        { scope: "global" },
        { scope: "profesional" },
        { scope: "paciente", pacienteId },
      ],
    },
    select: { termino: true },
  });

  return Array.from(new Set(hotWords.map((h) => h.termino))).sort();
}
