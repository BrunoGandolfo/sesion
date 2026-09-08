// Vocabulario clínico (hot words): la regla del término, en un solo lugar.
//
// AssemblyAI acepta hasta seis palabras por término en keyterms_prompt, que
// es lo que manda el worker: lo que pase de ahí lo ignora, así que un término
// de siete palabras no mejora la transcripción, solo ocupa lugar en la lista
// y hace creer que está sirviendo.
//
// El límite vive acá y no en el schema Zod del POST porque lo leen los dos
// lados: la validación del servidor (src/app/api/_lib/schemas.ts, que es
// quien decide) y el formulario de HotWordsManager, que lo avisa antes del
// viaje de red. Módulo puro —solo un número, un contador y un mensaje—, así
// lo puede importar un componente cliente sin arrastrar la capa API.

/** Máximo de palabras por término que acepta AssemblyAI. */
export const MAX_PALABRAS_TERMINO = 6;

/** Palabras de un término, separadas por espacios en blanco. */
export function contarPalabras(termino: string): number {
  const limpio = termino.trim();
  if (limpio === "") return 0;
  return limpio.split(/\s+/).length;
}

export function excedeMaximoPalabras(termino: string): boolean {
  return contarPalabras(termino) > MAX_PALABRAS_TERMINO;
}

/** El mismo aviso en la respuesta de la API y en el formulario. */
export const TERMINO_MUY_LARGO = `Un término puede tener hasta ${MAX_PALABRAS_TERMINO} palabras.`;
