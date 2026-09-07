// El micrófono: cómo se crea el MediaRecorder y qué se le dice a la
// profesional cuando el micrófono no está.
//
// Salió de src/components/grabacion/GrabadorSesion.tsx sin cambiar nada. Son
// las dos piezas que tocan APIs del navegador pero no tienen estado propio:
// se pueden probar con un doble del global y sin renderizar nada.
//
// Los mensajes de error importan más de lo que parece. Son lo único que ve
// alguien parada frente a una paciente con el micrófono que no arranca: la
// diferencia entre "no diste permiso" y "cerrá otras apps" es la diferencia
// entre poder grabar la sesión o no.

/**
 * Formatos que se le piden al MediaRecorder, en orden de preferencia. Opus en
 * webm es lo que mejor comprime voz y lo que el worker espera.
 */
const MIME_PREFERIDOS = ["audio/webm;codecs=opus", "audio/webm"];

/**
 * Traduce lo que tira `getUserMedia` a algo accionable.
 *
 * Los nombres duplicados (`NotAllowedError`/`PermissionDeniedError`,
 * `NotFoundError`/`DevicesNotFoundError`, `NotReadableError`/`TrackStartError`)
 * son el mismo caso con el nombre viejo y el nuevo según el navegador.
 */
export function mensajeErrorGrabacion(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "No diste permiso para usar el micrófono. Habilitalo y probá de nuevo.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No encontramos un micrófono disponible en este dispositivo.";
      case "NotReadableError":
      case "TrackStartError":
        return "No pudimos acceder al micrófono. Cerrá otras apps que lo estén usando y probá de nuevo.";
      case "SecurityError":
        return "Tu navegador bloqueó la grabación de audio en este contexto.";
      default:
        return "No se pudo iniciar la grabación de audio.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "No se pudo iniciar la grabación de audio.";
}

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
