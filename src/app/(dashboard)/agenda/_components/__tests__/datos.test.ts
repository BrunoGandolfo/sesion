// La lectura de la agenda sin pantalla: el rango que se pide, la URL con
// los cancelados y las flechas (atrás y adelante son el mismo paso con signo).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeRange, leerTurnos, moverAncla, type VistaAgenda } from "../datos";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

// Miércoles 16 de septiembre de 2026, 12:00 de Montevideo (UTC-3).
const ANCLA = new Date("2026-09-16T15:00:00.000Z");

describe("computeRange", () => {
  it("día: de la medianoche a la medianoche de Montevideo", () => {
    expect(computeRange("día", ANCLA)).toEqual({
      desde: new Date("2026-09-16T03:00:00.000Z"),
      hasta: new Date("2026-09-17T02:59:59.999Z"),
    });
  });

  it("semana: de lunes a domingo", () => {
    expect(computeRange("semana", ANCLA)).toEqual({
      desde: new Date("2026-09-14T03:00:00.000Z"),
      hasta: new Date("2026-09-21T02:59:59.999Z"),
    });
  });

  it("mes: 42 días desde el lunes de la semana del día 1", () => {
    const { desde, hasta } = computeRange("mes", ANCLA);
    // El 1 de septiembre de 2026 es martes: la grilla arranca el lunes 31 de agosto.
    expect(desde).toEqual(new Date("2026-08-31T03:00:00.000Z"));
    expect(hasta).toEqual(new Date("2026-10-12T02:59:59.999Z"));
  });
});

describe("leerTurnos", () => {
  beforeEach(() => m.get.mockReset());

  it("pide el rango con los cancelados y devuelve fechas como Date", async () => {
    m.get.mockResolvedValue([
      { id: "t1", fecha: "2026-09-16T13:00:00.000Z", creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", pagoFecha: null },
    ]);
    const control = new AbortController();
    const turnos = await leerTurnos(computeRange("día", ANCLA), control.signal);

    const [url, opciones] = m.get.mock.calls[0];
    expect(url).toBe(
      "/api/turnos?desde=2026-09-16T03%3A00%3A00.000Z&hasta=2026-09-17T02%3A59%3A59.999Z&includeCancelados=true",
    );
    expect(opciones).toEqual({ signal: control.signal });
    expect(turnos[0].fecha).toEqual(new Date("2026-09-16T13:00:00.000Z"));
  });
});

describe("moverAncla", () => {
  const escritorio = (view: VistaAgenda["view"]): VistaAgenda => ({ view, isMobile: false, mesAbierto: false });
  const casos: [string, VistaAgenda, string, string][] = [
    ["día en escritorio: un día", escritorio("día"), "2026-09-15T15:00:00.000Z", "2026-09-17T15:00:00.000Z"],
    ["semana en escritorio: siete días", escritorio("semana"), "2026-09-09T15:00:00.000Z", "2026-09-23T15:00:00.000Z"],
    ["mes en escritorio: un mes", escritorio("mes"), "2026-08-16T15:00:00.000Z", "2026-10-16T15:00:00.000Z"],
    ["teléfono con la tira: una semana", { view: "día", isMobile: true, mesAbierto: false }, "2026-09-09T15:00:00.000Z", "2026-09-23T15:00:00.000Z"],
    ["teléfono con el mes abierto: un mes", { view: "día", isMobile: true, mesAbierto: true }, "2026-08-16T15:00:00.000Z", "2026-10-16T15:00:00.000Z"],
  ];

  it.each(casos)("%s", (_caso, vista, atras, adelante) => {
    expect(moverAncla(ANCLA, -1, vista)).toEqual(new Date(atras));
    expect(moverAncla(ANCLA, 1, vista)).toEqual(new Date(adelante));
  });
});
