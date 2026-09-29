// Cobrar y deshacer un cobro desde el navegador. Es el único lugar que llama
// a /api/turnos/[id]/cobrar: antes lo hacían cuatro pantallas, cada una con
// su manejo del error (forense 03, P3-17).
//
// La regla de qué se puede cobrar la decide el servidor
// (casos-uso/cobrar-turno.ts, con sePuedeCobrar); acá sólo se pide.

import { apiDelete, apiPost } from "@/lib/api-client";
import { parseTurno, type TurnoJson } from "@/lib/json-turno";
import type { MetodoPago, Turno } from "@/types/domain";

/** POST: cobra el turno con `metodo` y devuelve el turno como quedó. Un
 *  turno programado queda además realizado. */
export async function cobrarTurno(turnoId: string, metodo: MetodoPago): Promise<Turno> {
  return parseTurno(await apiPost<TurnoJson>(`/api/turnos/${turnoId}/cobrar`, { metodo }));
}

/**
 * DELETE: deshace el último cobro. El turno vuelve a `pagoEstado:
 * "pendiente"` y su monto vuelve a la deuda; el estado del turno no cambia y
 * no se borra nada, así que se puede volver a cobrar enseguida.
 * `actualizadoEn` es el del turno que ella vio: si cambió en el medio, 409.
 */
export async function deshacerCobro(turnoId: string, actualizadoEn: Date): Promise<Turno> {
  return parseTurno(
    await apiDelete<TurnoJson>(`/api/turnos/${turnoId}/cobrar`, { actualizadoEn }),
  );
}
