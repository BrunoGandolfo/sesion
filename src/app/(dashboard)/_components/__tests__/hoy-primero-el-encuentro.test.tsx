// @vitest-environment jsdom
//
// En el teléfono, lo primero que se ve en Hoy es quién viene ahora o después,
// con "Preparar sesión". Hasta el 20/9 la tarjeta de ahora quedaba debajo de la
// agenda y de los pendientes: había que pasar toda la deuda para llegar a la
// paciente que está entrando.
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Dashboard } from "../dashboard";
import { leerHoy, SIN_PENDIENTES } from "../datos";
import type { TurnoConPaciente } from "@/types/domain";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../datos", async (original) => ({
  ...(await original<typeof import("../datos")>()),
  leerHoy: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ apiGet: vi.fn().mockResolvedValue(null), apiPost: vi.fn(), ApiClientError: class extends Error {} }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ CabeceraUsuario: () => null }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const AHORA = new Date("2026-09-11T15:00:00Z");
const TURNO: TurnoConPaciente = {
  id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
  fecha: new Date("2026-09-11T16:00:00Z"), duracion: 50, modalidad: "presencial",
  estado: "programado", tarifaCobrada: 2200, pagoEstado: "pendiente", pagoFecha: null,
  pagoMetodo: null, notas: null, creadoEn: AHORA, actualizadoEn: AHORA, sesionClinica: null,
  paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222" },
};

it("lo primero de Hoy es el próximo encuentro, con Preparar sesión; después la agenda y los pendientes", async () => {
  vi.mocked(leerHoy).mockResolvedValue({
    nombre: null, ahora: AHORA, riesgoEnElDia: false,
    data: {
      inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
      kpis: { sesionesHoy: 1, deudaAcumulada: 43100, ingresosMes: 0 },
      sesionesHoy: [TURNO], deudores: [], proximaSesion: TURNO, riesgoDelDia: [],
      pendientes: {
        ...SIN_PENDIENTES,
        totalSinCobrar: { pacientes: 12, sesiones: 20, monto: 43100 },
        sinCobrar: [{ pacienteId: "p9", pacienteNombre: "Otra Paciente", sesiones: 20, monto: 43100, masAntiguo: "2026-09-01T15:00:00Z" }],
      },
    },
  });

  render(<Dashboard />);

  const encuentro = await screen.findByRole("heading", { name: "Ana López" });
  const agenda = screen.getByText("Agenda del día");
  const deuda = screen.getByText("12 pacientes te deben · $ 43.100");

  const antes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(antes(encuentro, agenda), "el encuentro va antes que la agenda").toBe(true);
  expect(antes(agenda, deuda), "la agenda va antes que los pendientes").toBe(true);

  const preparar = screen.getByRole("link", { name: "Preparar sesión" });
  expect(preparar.getAttribute("href")).toBe("/pacientes/p1?preparar=1");
});
