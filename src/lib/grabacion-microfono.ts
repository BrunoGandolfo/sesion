// El micrófono: cómo se crea el MediaRecorder. Toca APIs del navegador pero
// no tiene estado propio: se prueba con un doble del global y sin renderizar
// nada. Qué se le dice a ella cuando el micrófono no arranca está en el
// catálogo de errores (src/lib/errores-grabacion.ts).

/**
 * Formatos que se le piden al MediaRecorder, en orden de preferencia. Opus en
 * webm es lo que mejor comprime voz y lo que el worker espera.
 */
const MIME_PREFERIDOS = ["audio/webm;codecs=opus", "audio/webm"];

/**
 * MediaRecorder con el mejor formato que el navegador acepte, y sin opciones
 * si no acepta ninguno — que el navegador elija es mejor que no grabar.
 *
 * El try/catch por candidato no es paranoia: hay navegadores donde
 * `isTypeSupported` dice que sí y el constructor tira igual.
 */
export function crearMediaRecorder(stream: MediaStream) {
  for (const mimeType of MIME_PREFERIDOS) {
    try {
      if (
        typeof MediaRecorder.isTypeSupported === "function" &&
        !MediaRecorder.isTypeSupported(mimeType)
      ) {
        continue;
      }

      return new MediaRecorder(stream, { mimeType });
    } catch {
      continue;
    }
  }

  return new MediaRecorder(stream);
}
