// El turno y la sesión de una grabación, al subirla. Sin React: lo usa
// flujo-grabacion.ts, que guarda en sus refs lo que esto devuelve. Grabar no
// los necesita: se piden recién al subir (ver la cabecera del flujo).

import { ApiClientError, apiPost } from "@/lib/api-client";
import { SESION_EN_CAMINO } from "@/lib/glosario";
import { inicioDeClaveSinTurno } from "@/lib/grabacion-clave";
import { leerSesionDelTurno, type SesionDelTurno } from "@/lib/grabacion-sesion";
import { asociarTurno } from "@/lib/grabacion-storage";
import { volverAGrabando } from "@/lib/subida-audio";

/** Duración por defecto del turno creado al vuelo. */
const DURACION_SIN_TURNO = 50;

export type TurnoCreado = { id: string; fecha: string };

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

/** El turno de una grabación sin turno, con la hora en que EMPEZÓ, anotado en
 *  la copia del teléfono para que un reintento no lo cree dos veces. Sin la
 *  hora en memoria (se cerró el navegador) la saca de la clave. */
export async function crearTurnoDeLaGrabacion({
  pacienteId,
  clave,
  inicio,
}: {
  pacienteId: string;
  clave: string | null;
  inicio: Date | null;
}): Promise<TurnoCreado> {
  const desde = inicio ?? (clave ? inicioDeClaveSinTurno(clave) : null);
  if (!desde) throw new Error("grabación sin turno y sin hora de inicio");
  const creado = await apiPost<TurnoCreado>("/api/turnos", {
    pacienteId,
    fecha: desde.toISOString(),
    duracion: DURACION_SIN_TURNO,
    modalidad: "presencial",
    // Un turno que nace al grabar no pasa por la regla de choque: la
    // sesión ocurrió, y un solapamiento en la agenda no puede impedir
    // guardarla.
    alGrabar: true,
    iniciadaEn: desde.toISOString(),
  });
  if (clave) await asociarTurno(clave, creado.id);
  return creado;
}
