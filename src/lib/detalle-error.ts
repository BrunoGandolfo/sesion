// El texto técnico de un error, para logs y diagnóstico del servidor.
// Lo que se le muestra a ella no sale de acá: eso es `mensajeParaElla`
// (src/lib/api-client.ts), que nunca muestra el `message` de un Error.

/** `message` si es un Error; si no, `siNoEsError` o `String(error)`. */
export function detalleDeError(error: unknown, siNoEsError?: string): string {
  if (error instanceof Error) return error.message;
  return siNoEsError ?? String(error);
}
