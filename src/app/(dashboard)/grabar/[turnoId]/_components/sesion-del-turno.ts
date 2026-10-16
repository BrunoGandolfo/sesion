// La sesión clínica de una grabación, al subirla. Sin React: lo usa
// flujo-grabacion.ts. Grabar no la necesita: se pide recién al subir (ver la
// cabecera del flujo). El turno de una grabación sin turno lo crea el flujo
// mismo (asegurarTurno), que lo guarda en sus refs antes de anotarlo en el
// teléfono.

import { ApiClientError, apiPost } from "@/lib/api-client";
import { SESION_EN_CAMINO } from "@/lib/glosario";
import { leerSesionDelTurno, type SesionDelTurno } from "@/lib/grabacion-sesion";
import { volverAGrabando } from "@/lib/subida-audio";

/**
 * Deja la sesión clínica del turno en estado "grabando" y devuelve su id.
 * Tolera reentrar con una sesión ya empezada (volvió atrás, se le cerró el
 * navegador) y una subida que quedó a medias. `inicio` viaja al crearla: el
 * servidor acepta una grabación del día del turno aunque llegue pasada la
 * medianoche (plazo-grabacion.ts).
 */
export async function asegurarSesion(turno: string, inicio: Date | null): Promise<string> {
  let sesion = await leerSesionDelTurno(turno);

  if (!sesion) {
    sesion = await apiPost<SesionDelTurno>("/api/sesion-clinica", {
      turnoId: turno,
      ...(inicio ? { iniciadaEn: inicio.toISOString() } : {}),
    });
  }

  if (sesion.estado === "subiendo") {
    await volverAGrabando(sesion.id);
    return sesion.id;
  }

  if (sesion.estado !== "grabando") {
    throw new ApiClientError(SESION_EN_CAMINO, 409);
  }

  return sesion.id;
}
