// Vocabulario para el ASR. El término va cifrado (cifrarHotWord) con un
// termino_hash para la unicidad; en la API sigue llamándose `scope` lo que en
// la base es `alcance`, así la pantalla no cambia.
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { hashTermino } from "@/lib/hot-words";
import { cifrarHotWord } from "@/lib/prisma-encryption";

import { getOrganizationId } from "../_lib/auth";
import { ApiError, errorResponse, ok, validationError } from "../_lib/responses";
import { hotWordItemSchema, hotWordsBulkSchema, hotWordsQuerySchema } from "../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CATEGORIAS = ["termino_clinico", "modismo_rioplatense", "nombre_propio", "otro"] as const;
type Categoria = (typeof CATEGORIAS)[number];

function categoriaDe(valor: string | null | undefined): Categoria | null {
  if (valor == null || valor === "") return null;
  if ((CATEGORIAS as readonly string[]).includes(valor)) return valor as Categoria;
  throw new ApiError(`Categoría inválida: ${valor}`, 400);
}

/** Lo que devuelve la API por término. `termino` sale descifrado por la extensión. */
const SELECT = { id: true, termino: true, alcance: true, categoria: true, activo: true } as const;

function aRespuesta(h: { id: string; termino: string; alcance: string; categoria: string | null; activo: boolean }) {
  return { id: h.id, termino: h.termino, scope: h.alcance, categoria: h.categoria, activo: h.activo };
}

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);
    const parsed = hotWordsQuerySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      pacienteId: url.searchParams.get("pacienteId") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.scope === "paciente" && !parsed.data.pacienteId) {
      throw new ApiError("pacienteId es obligatorio cuando scope === 'paciente'", 400);
    }

    const where: Prisma.HotWordWhereInput = {
      organizationId,
      alcance: parsed.data.scope,
      pacienteId: parsed.data.scope === "paciente" ? parsed.data.pacienteId : null,
    };

    // El término está cifrado: no se puede ordenar en SQL. Se ordena acá.
    const hotWords = await db.hotWord.findMany({ where, select: SELECT });
    hotWords.sort((a, b) => a.termino.localeCompare(b.termino, "es"));
    return ok(hotWords.map(aRespuesta));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body: unknown = await request.json();

    if (typeof body === "object" && body !== null && "hotWords" in body) {
      const parsed = hotWordsBulkSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      await assertPacientesExisten(parsed.data.hotWords, organizationId);

      const data = await Promise.all(
        parsed.data.hotWords.map(async (h) => ({
          organizationId,
          alcance: h.scope,
          categoria: categoriaDe(h.categoria),
          pacienteId: h.scope === "paciente" ? h.pacienteId ?? null : null,
          terminoHash: await hashTermino(h.termino),
          ...cifrarHotWord(randomUUID(), { termino: h.termino }),
        })),
      );
      // skipDuplicates: la unicidad es por termino_hash (y el índice parcial
      // para los que no tienen paciente), no por el blob cifrado.
      const result = await db.hotWord.createMany({ data, skipDuplicates: true });
      return ok({ count: result.count }, 201);
    }

    const parsed = hotWordItemSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    await assertPacientesExisten([parsed.data], organizationId);

    try {
      const hotWord = await db.hotWord.create({
        data: {
          organizationId,
          alcance: parsed.data.scope,
          categoria: categoriaDe(parsed.data.categoria),
          pacienteId: parsed.data.scope === "paciente" ? parsed.data.pacienteId ?? null : null,
          terminoHash: await hashTermino(parsed.data.termino),
          ...cifrarHotWord(randomUUID(), { termino: parsed.data.termino }),
        },
        select: SELECT,
      });
      return ok(aRespuesta(hotWord), 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError("Hot word duplicado", 409);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

async function assertPacientesExisten(
  items: Array<{ scope: string; pacienteId?: string | null }>,
  organizationId: string,
) {
  const ids = Array.from(new Set(items.filter((i) => i.scope === "paciente" && i.pacienteId).map((i) => i.pacienteId as string)));
  if (ids.length === 0) return;
  const pacientes = await db.paciente.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
  if (pacientes.length !== ids.length) throw new ApiError("Paciente no encontrado", 404);
}
