// @vitest-environment jsdom
//
// Turnos y pagos de la ficha: la columna de pago y el aviso de arriba dicen lo
// mismo que el botón Cobrar (sePuedeCobrar). Un turno agendado cuya hora ya
// pasó se puede cobrar, así que figura "Sin cobrar" y se cuenta.
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  COBRAR,
  DESHACER_COBRO,
  DESHACER_COBRO_MENSAJE,
  DESHACER_COBRO_MENSAJE_SIN_DEUDA,
  METODO_PAGO_LABEL,
  PAGADO,
  PENDIENTE,
  SESIONES_SIN_COBRAR_DETALLE,
} from "@/lib/glosario";
import type { Turno } from "@/types/domain";

import { deudaDeTurnos } from "@/app/api/_lib/domain";

import { TurnosPagosTab } from "../turnos-pagos-tab";

vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

function turno(id: string, fecha: Date, extra: Partial<Turno> = {}): Turno {
  return {
    id, organizationId: "org", pacienteId: "p1", serieId: null, fecha, duracion: 50,
    modalidad: "presencial", estado: "programado", tarifaCobrada: 2000, pagoEstado: "pendiente",
    pagoFecha: null, pagoMetodo: null, notas: null, creadoEn: fecha, actualizadoEn: fecha, ...extra,
  } as Turno;
}

it("el aviso cuenta la deuda de la cabecera: un agendado que ya pasó se puede cobrar, pero no es deuda", () => {
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const turnos = [
    turno("pasado", haceUnaHora),
    turno("realizado", new Date(Date.now() - 48 * 60 * 60 * 1000), { estado: "realizado", tarifaCobrada: 1500 }),
    turno("futuro", manana),
  ];
  render(<TurnosPagosTab turnos={turnos} />);

  // Las dos filas que se pueden cobrar dicen "Sin cobrar" y ofrecen Cobrar.
  expect(screen.getAllByText(PENDIENTE).length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByRole("button", { name: COBRAR })).toHaveLength(2);
  // El aviso, lo mismo que deudaDeTurnos (la cabecera, deudaDePaciente): el realizado.
  const aviso = screen.getByRole("status");
  expect(deudaDeTurnos(turnos)).toEqual({ sesionesImpagas: 1, deudaTotal: 1500 });
  expect(aviso.textContent).toContain("1 sesión sin cobrar");
  expect(aviso.textContent).toContain(SESIONES_SIN_COBRAR_DETALLE);
  expect(aviso.textContent?.match(/\$ 1\.500/g)).toHaveLength(1);
});

// C2: un turno cobrado que después pasó a "No vino" o "Cancelado" sigue
// cobrado. La ficha lo muestra y deja deshacerlo, como la Agenda y el servidor
// (que sólo miran pagoEstado).
it.each(["realizado", "ausente", "cancelado"] as const)(
  "un turno %s cobrado figura Pagado, con su método, y se puede deshacer",
  (estado) => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    render(
      <TurnosPagosTab
        turnos={[turno("t", ayer, { estado, pagoEstado: "pagado", pagoMetodo: "efectivo", pagoFecha: ayer })]}
      />,
    );
    expect(screen.getByText(PAGADO)).toBeTruthy();
    expect(screen.getByText(METODO_PAGO_LABEL.efectivo)).toBeTruthy();
    expect(screen.getByRole("button", { name: DESHACER_COBRO })).toBeTruthy();
  },
);

// Deshacer el cobro de un turno que no vino no lo devuelve a la deuda: la
// confirmación no puede prometer que se vuelve a cobrar.
it.each([
  ["realizado", DESHACER_COBRO_MENSAJE],
  ["ausente", DESHACER_COBRO_MENSAJE_SIN_DEUDA],
  ["cancelado", DESHACER_COBRO_MENSAJE_SIN_DEUDA],
] as const)("la confirmación de deshacer en un turno %s dice lo que pasa", (estado, mensaje) => {
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
  render(
    <TurnosPagosTab
      turnos={[turno("t", ayer, { estado, pagoEstado: "pagado", pagoMetodo: "efectivo", pagoFecha: ayer })]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: DESHACER_COBRO }));
  expect(screen.getByText(mensaje)).toBeTruthy();
});
