// Casos de uso del vocabulario para el ASR (hot words): listar, cargar (de a
// uno o en lote), activar/desactivar, recategorizar y borrar.
//
// Vivían dentro de GET/POST /api/hot-words y PATCH/DELETE /api/hot-words/[id].
// Las rutas ahora solo validan y llaman. Lo que el worker lee para una
// sesión (los términos activos de una paciente) es otro caso de uso:
// terminos-asr.ts.
//
// En la API el alcance se sigue llamando `scope`, como siempre lo leyó la
// pantalla; en la base es `alcance`. El término va cifrado (puede ser un
// nombre propio del entorno de la paciente) con un hash del término
// normalizado sólo para la unicidad. Firmas del anexo de docs/esquema.md y
// del área 3: `cifrarHotWord(id, { termino })` de @/lib/prisma-encryption y
// `hashTermino(termino)` de @/lib/hot-words; el campo lógico `termino` lo
// descifra la extensión al leer.

import { MENSAJE_HOT_WORD_DUPLICADA, MENSAJE_FALTA_PACIENTE } from "@/lib/glosario";
import { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";
import { hashTermino } from "@/lib/hot-words";
import { cifrarHotWord } from "@/lib/prisma-encryption";

import { ApiError } from "../responses";
import type { CATEGORIAS_HOT_WORD } from "../schemas";

type ClientePrisma = typeof db;

export type ScopeHotWord = "global" | "profesional" | "paciente";
export type CategoriaHotWord = (typeof CATEGORIAS_HOT_WORD)[number];

/** Un término tal como lo ve la pantalla. */
export interface HotWordApi {
  id: string;
  termino: string;
  scope: ScopeHotWord;
  categoria: CategoriaHotWord | null;
  activo: boolean;
}

/** Lo que se lee de cada fila. `termino` sale descifrado por la extensión. */
const SELECT = {
  id: true,
  termino: true,
  alcance: true,
  categoria: true,
  activo: true,
} as const;

function aRespuesta(fila: {
  id: string;
  termino: string;
  alcance: ScopeHotWord;
  categoria: CategoriaHotWord | null;
  activo: boolean;
}): HotWordApi {
  return {
    id: fila.id,
    termino: fila.termino,
    scope: fila.alcance,
    categoria: fila.categoria,
    activo: fila.activo,
  };
}


// ────────────────────────────────────────────────────────────────────────────
// Lectura
// ────────────────────────────────────────────────────────────────────────────

export interface ListarHotWordsInput {
  prisma: ClientePrisma;
  organizationId: string;
  scope: ScopeHotWord;
  /** Obligatorio si scope es "paciente"; se ignora si no. */
  pacienteId?: string;
}

/** Los términos de un alcance (los de una paciente, si es "paciente"),
 *  ordenados por término. El término está cifrado, así que el orden se hace
 *  acá y no en SQL. */
export async function listarHotWords({
  prisma,
  organizationId,
  scope,
  pacienteId,
}: ListarHotWordsInput): Promise<HotWordApi[]> {
  if (scope === "paciente" && !pacienteId) {
    throw new ApiError(MENSAJE_FALTA_PACIENTE, 400);
  }

  const filas = await prisma.hotWord.findMany({
    where: {
      organizationId,
      alcance: scope,
      pacienteId: scope === "paciente" ? pacienteId : null,
    },
    select: SELECT,
  });

  return filas
    .map(aRespuesta)
    .sort((a, b) => a.termino.localeCompare(b.termino, "es"));
}

// ────────────────────────────────────────────────────────────────────────────
// Escritura
// ────────────────────────────────────────────────────────────────────────────

export interface HotWordNueva {
  termino: string;
  scope: ScopeHotWord;
  categoria?: CategoriaHotWord | null;
  pacienteId?: string | null;
}

/** Que cada paciente nombrada exista y sea de esta organización. */
async function assertPacientesExisten(
  prisma: ClientePrisma,
  organizationId: string,
  items: HotWordNueva[],
): Promise<void> {
  const ids = Array.from(
    new Set(
      items
        .filter((i) => i.scope === "paciente" && i.pacienteId)
        .map((i) => i.pacienteId as string),
    ),
  );
  if (ids.length === 0) return;

  const pacientes = await prisma.paciente.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });

  if (pacientes.length !== ids.length) {
    throw new ApiError("Paciente no encontrado", 404);
  }
}

async function filaNueva(organizationId: string, h: HotWordNueva) {
  return {
    organizationId,
    alcance: h.scope,
    categoria: h.categoria ?? null,
    pacienteId: h.scope === "paciente" ? (h.pacienteId ?? null) : null,
    terminoHash: await hashTermino(h.termino),
    ...cifrarHotWord(crypto.randomUUID(), { termino: h.termino }),
  };
}

export interface CrearHotWordInput {
  prisma: ClientePrisma;
  organizationId: string;
  hotWord: HotWordNueva;
}

/** Un término. 409 si ya existe en ese alcance (la unicidad es por el hash
 *  del término normalizado, no por el blob cifrado). */
export async function crearHotWord({
  prisma,
  organizationId,
  hotWord,
}: CrearHotWordInput): Promise<HotWordApi> {
  await assertPacientesExisten(prisma, organizationId, [hotWord]);

  try {
    const fila = await prisma.hotWord.create({
      data: await filaNueva(organizationId, hotWord),
      select: SELECT,
    });
    return aRespuesta(fila);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(MENSAJE_HOT_WORD_DUPLICADA, 409);
    }
    throw error;
  }
}

export interface CrearHotWordsInput {
  prisma: ClientePrisma;
  organizationId: string;
  hotWords: HotWordNueva[];
}

/** Carga masiva. Los repetidos se saltean; devuelve cuántos entraron. */
export async function crearHotWords({
  prisma,
  organizationId,
  hotWords,
}: CrearHotWordsInput): Promise<{ count: number }> {
  await assertPacientesExisten(prisma, organizationId, hotWords);

  const data = await Promise.all(hotWords.map((h) => filaNueva(organizationId, h)));
  const result = await prisma.hotWord.createMany({ data, skipDuplicates: true });

  return { count: result.count };
}

export interface ActualizarHotWordInput {
  prisma: ClientePrisma;
  organizationId: string;
  hotWordId: string;
  cambios: { activo?: boolean; categoria?: CategoriaHotWord | null };
}

export async function actualizarHotWord({
  prisma,
  organizationId,
  hotWordId,
  cambios,
}: ActualizarHotWordInput): Promise<HotWordApi> {
  // La organización va en el WHERE de la escritura, no en un chequeo previo.
  // Mismo patrón que paciente y turno.
  const { count } = await prisma.hotWord.updateMany({
    where: { id: hotWordId, organizationId },
    data: { activo: cambios.activo, categoria: cambios.categoria },
  });

  if (count === 0) {
    throw new ApiError("Hot word no encontrado", 404);
  }

  const fila = await prisma.hotWord.findUniqueOrThrow({
    where: { id: hotWordId },
    select: SELECT,
  });

  return aRespuesta(fila);
}

export interface BorrarHotWordInput {
  prisma: ClientePrisma;
  organizationId: string;
  hotWordId: string;
}

export async function borrarHotWord({
  prisma,
  organizationId,
  hotWordId,
}: BorrarHotWordInput): Promise<{ id: string }> {
  const { count } = await prisma.hotWord.deleteMany({
    where: { id: hotWordId, organizationId },
  });

  if (count === 0) {
    throw new ApiError("Hot word no encontrado", 404);
  }

  return { id: hotWordId };
}
