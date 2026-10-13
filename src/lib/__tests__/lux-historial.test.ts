// Unitario — el historial que viaja al modelo: los últimos turnos, con un
// tope total de caracteres que se cumple descartando los más viejos.

import { describe, expect, it } from "vitest";

import { historialQueViaja } from "@/app/api/_lib/casos-uso/lux/conversar";
import { MAX_TURNOS_HISTORIAL } from "@/app/api/_lib/casos-uso/responder-ayuda";
import { LARGO_MAX_HISTORIAL_LUX, LARGO_MAX_TURNO_LUX, type TurnoHistorialLux } from "@/lib/lux/contrato";

const lux = (texto: string): TurnoHistorialLux => ({ rol: "asistente", texto });
const ella = (texto: string): TurnoHistorialLux => ({ rol: "usuaria", texto });
const largo = (turnos: TurnoHistorialLux[]) => turnos.reduce((n, t) => n + t.texto.length, 0);

describe("historialQueViaja", () => {
  it("cabe al menos un turno de Lux del largo máximo", () => {
    expect(LARGO_MAX_TURNO_LUX).toBeLessThanOrEqual(LARGO_MAX_HISTORIAL_LUX);
    const uno = [lux("a".repeat(LARGO_MAX_TURNO_LUX))];
    expect(historialQueViaja(uno)).toEqual(uno);
  });

  it("debajo del tope deja los últimos MAX_TURNOS_HISTORIAL, sin vacíos", () => {
    const turnos = Array.from({ length: 10 }, (_, i) => (i % 2 ? ella(`p${i}`) : lux(`r${i}`)));
    expect(historialQueViaja([...turnos, lux("   ")])).toEqual(turnos.slice(-MAX_TURNOS_HISTORIAL));
  });

  it("seis respuestas largas no viajan enteras: se caen las más viejas hasta entrar", () => {
    const turnos = Array.from({ length: 6 }, (_, i) => (i % 2 ? ella(`¿${i}?`) : lux(`${i}`.repeat(50_000))));
    expect(largo(turnos)).toBeGreaterThan(LARGO_MAX_HISTORIAL_LUX);
    const viaja = historialQueViaja(turnos);
    expect(largo(viaja)).toBeLessThanOrEqual(LARGO_MAX_HISTORIAL_LUX);
    // Se recorta desde el principio: lo que queda es el final, contiguo.
    expect(viaja).toEqual(turnos.slice(-viaja.length));
    expect(viaja).toEqual(turnos.slice(1));
  });
});
