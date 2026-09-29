// @vitest-environment jsdom
//
// Turnos y pagos de la ficha: la columna de pago y el aviso de arriba dicen lo
// mismo que el botón Cobrar (sePuedeCobrar). Un turno agendado cuya hora ya
// pasó se puede cobrar, así que figura "Sin cobrar" y se cuenta.
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { COBRAR, PENDIENTE, SESIONES_SIN_COBRAR_DETALLE } from "@/lib/glosario";
import type { Turno } from "@/types/domain";

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

it("un agendado que ya pasó figura sin cobrar y se cuenta; uno futuro no", () => {
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
  render(
    <TurnosPagosTab
      turnos={[
        turno("pasado", haceUnaHora),
        turno("realizado", new Date(Date.now() - 48 * 60 * 60 * 1000), { estado: "realizado", tarifaCobrada: 1500 }),
        turno("futuro", manana),
      ]}
    />,
  );

  expect(screen.getAllByText(PENDIENTE).length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByRole("button", { name: COBRAR })).toHaveLength(2);
  const aviso = screen.getByRole("status");
  expect(aviso.textContent).toContain("2 sesiones sin cobrar");
  expect(aviso.textContent).toContain(SESIONES_SIN_COBRAR_DETALLE);
  // El monto va una vez, no dos.
  expect(aviso.textContent?.match(/\$ 3\.500/g)).toHaveLength(1);
});
