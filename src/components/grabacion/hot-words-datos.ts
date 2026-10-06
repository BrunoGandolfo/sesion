// Lecturas, mutaciones y reglas del vocabulario de la transcripción (hot
// words): lo que HotWordsManager le pide a /api/hot-words y cómo lo dice.
// Sin estado, sin efectos, sin React.

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ApiClientError,
  mensajeParaElla,
} from "@/lib/api-client";

export type Categoria =
  | "termino_clinico"
  | "modismo_rioplatense"
  | "nombre_propio"
  | "otro";

export type Scope = "global" | "profesional" | "paciente";

export type ChipVariant = "sage" | "terracotta" | "gold" | "neutral";

// Lo que devuelve la API, no lo que uno querría que devolviera: `categoria`
// es String? en la base (puede venir null o con un valor viejo que ya no está
// en CATEGORIAS) y el select de la ruta no incluye `pacienteId`, que este
// componente además ya sabe porque se lo pasan por prop.
export interface HotWord {
  id: string;
  termino: string;
  categoria: string | null;
  activo: boolean;
  scope: Scope;
}

export interface CategoriaInfo {
  value: Categoria;
  label: string;
  chipLabel: string;
  variant: ChipVariant;
}

export const CATEGORIAS: ReadonlyArray<CategoriaInfo> = [
  {
    value: "termino_clinico",
    label: "Término clínico",
    chipLabel: "Clínico",
    variant: "sage",
  },
  {
    value: "modismo_rioplatense",
    label: "Modismo rioplatense",
    chipLabel: "Modismo",
    variant: "neutral",
  },
  {
    value: "nombre_propio",
    label: "Nombre propio",
    chipLabel: "Nombre",
    variant: "neutral",
  },
  {
    value: "otro",
    label: "Otro",
    chipLabel: "Otro",
    variant: "neutral",
  },
];

/** A partir de cuántos términos el modo compacto muestra el buscador. */
export const BUSQUEDA_DESDE = 8;

export function infoCategoria(cat: string | null): CategoriaInfo {
  return CATEGORIAS.find((c) => c.value === cat) ?? CATEGORIAS[3];
}

export function tituloScope(scope: Scope, pacienteNombre?: string): string {
  if (scope === "global") return "Vocabulario global";
  if (scope === "profesional") return "Vocabulario propio";
  return pacienteNombre
    ? `Vocabulario de ${pacienteNombre}`
    : "Vocabulario del paciente";
}

/** Los términos cuyo texto contiene la búsqueda, sin mayúsculas. */
export function filtrarPorTermino(items: HotWord[], busqueda: string): HotWord[] {
  const needle = busqueda.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.termino.toLowerCase().includes(needle));
}

/** La carga masiva: un término por coma o por renglón, sin vacíos. */
export function terminosDeTexto(texto: string): string[] {
  return texto
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function cargarHotWords(
  scope: Scope,
  pacienteId: string | undefined,
  signal: AbortSignal,
): Promise<HotWord[]> {
  const params = new URLSearchParams({ scope });
  if (pacienteId) params.set("pacienteId", pacienteId);
  return apiGet<HotWord[]>(`/api/hot-words?${params.toString()}`, { signal });
}

export function crearHotWord(datos: {
  termino: string;
  categoria: Categoria;
  scope: Scope;
  pacienteId: string | undefined;
}): Promise<HotWord> {
  return apiPost<HotWord>("/api/hot-words", {
    termino: datos.termino,
    categoria: datos.categoria,
    scope: datos.scope,
    pacienteId: datos.pacienteId ?? null,
  });
}

/** El texto de un alta que falló: "ya existe" en un 409, el motivo del
 *  servidor si lo dio, o uno propio (nunca el error técnico). */
export function mensajeAlAgregar(err: unknown): string {
  return err instanceof ApiClientError && err.status === 409
    ? "Este término ya existe"
    : mensajeParaElla(err, "No pudimos agregar el término. Intentá de nuevo.");
}

export async function cambiarActivo(id: string, activo: boolean): Promise<void> {
  await apiPatch(`/api/hot-words/${id}`, { activo });
}

export async function borrarHotWord(id: string): Promise<void> {
  await apiDelete(`/api/hot-words/${id}`);
}

/** El POST masivo espera { hotWords: [...] }, un item completo por término:
 *  mandaba { terminos, categoria, scope } —una forma que la ruta nunca
 *  aceptó— y caía siempre en el 400 del item suelto. */
export async function importarHotWords(datos: {
  terminos: string[];
  categoria: Categoria;
  scope: Scope;
  pacienteId: string | undefined;
}): Promise<void> {
  await apiPost("/api/hot-words", {
    hotWords: datos.terminos.map((termino) => ({
      termino,
      scope: datos.scope,
      categoria: datos.categoria,
      pacienteId: datos.scope === "paciente" ? datos.pacienteId ?? null : null,
    })),
  });
}
