// El system prompt de Lux, que vive en system-prompt.md al lado de este
// archivo para que se lea y se edite como texto, no como un string de TS.
//
// Se carga igual que el corpus de Lupita (ayuda-corpus.ts): node:fs, una
// sola lectura por instancia y nada variable adentro. El prompt es parte del
// prefijo cacheado: lo que cambia por paciente es el material, y va en su
// propio bloque (casos-uso/lux/material.ts).
//
// OJO CON EL DEPLOY: Next traza imports, no lecturas de disco. next.config.ts
// declara el archivo en outputFileTracingIncludes para la ruta
// /api/pacientes/[id]/lux; si esa línea se cae, en local no se nota y en
// Vercel la ruta contesta 502 (lux-prompt.test.ts lo vigila).
//
// Runtime nodejs. No es alcanzable desde src/proxy.ts (regla 9).

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Relativo a la raíz del proyecto, que es el cwd de la función. */
export const RUTA_PROMPT_LUX = join("src", "lib", "lux", "system-prompt.md");

let promptCache: string | null = null;

export function systemPromptLux(raiz: string = process.cwd()): string {
  if (promptCache !== null) return promptCache;
  promptCache = readFileSync(join(raiz, RUTA_PROMPT_LUX), "utf8").trim();
  return promptCache;
}

/** Solo para los tests. */
export function olvidarPromptLux(): void {
  promptCache = null;
}
