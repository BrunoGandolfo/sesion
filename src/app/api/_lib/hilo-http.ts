import { esOrigenPropio } from "@/lib/sesion-cookie";
import { getSessionActor } from "./auth";
import { ApiError, ok } from "./responses";

// /hilo queda fuera del proxy porque también recibe al worker. Las
// escrituras humanas conservan aquí la misma protección de origen.
export async function autorizarEdicionHilo(request: Request) {
  if (!esOrigenPropio(request.method, request.headers, request.headers.get("host") ?? new URL(request.url).host)) {
    throw new ApiError("Origen no permitido", 403);
  }
  return getSessionActor();
}

export function responderHilo<T>(contenido: T) {
  const respuesta = ok(contenido);
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
