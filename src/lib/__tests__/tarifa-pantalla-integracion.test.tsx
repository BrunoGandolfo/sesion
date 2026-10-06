// @vitest-environment jsdom
//
// La tarifa de punta a punta: la ficha guarda una tarifa nueva, el PATCH
// llega a la RUTA real, actualizarPaciente reescribe en Postgres el turno
// programado futuro y la pantalla dice cuántos.
//
// Es tarifa-aviso.test.tsx (panel de pantallas) sin el mock de la ruta: allá
// apiPatch devolvía `turnosActualizados` inventado; acá el número sale del
// servidor y de la base. Lo de tarifa-turnos.test.ts (qué turnos alcanza)
// no se repite: esto cuida el contrato entre las dos puntas.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { conectarArea2, crearOrg, limpiarOrg, type BaseArea2, type Org } from "./estados-fixtures";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseArea2, actor: { organizationId: "", userId: "" } }));

vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));
vi.mock("@/app/api/_lib/auth", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/auth")>()),
  getOrganizationId: async () => estado.actor.organizationId,
  getSessionActor: async () => estado.actor,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pacientes",
  useSearchParams: () => new URLSearchParams(),
}));
// Las mismas piezas que tarifa-aviso.test.tsx deja afuera: no hablan con la
// ruta de la paciente.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, ariaLabel, children }: { open: boolean; ariaLabel: string; children: ReactNode }) =>
    open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));
vi.mock("@/hooks/useGrabacionSesion", () => ({ useGrabacionSesion: () => ({ sesionClinica: null, loading: false }) }));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("@/app/(dashboard)/pacientes/[id]/_components/sesiones-tab", () => ({ SesionesTab: () => null }));
vi.mock("@/app/(dashboard)/pacientes/[id]/_components/recorrido-tab", () => ({ RecorridoTab: () => null }));
vi.mock("@/app/(dashboard)/pacientes/[id]/_components/ficha-tab", () => ({ FichaTab: () => null }));

let org: Org;
let turnoFuturo: string;
const DIA = 24 * 60 * 60 * 1000;

beforeAll(() => { estado.base = conectarArea2(); });
afterAll(async () => { await estado.base.prisma.$disconnect(); });

beforeEach(async () => {
  org = await crearOrg(estado.base.prisma);
  estado.actor = { organizationId: org.orgId, userId: org.userId };
  turnoFuturo = (await estado.base.prisma.turno.create({
    data: {
      organizationId: org.orgId, pacienteId: org.pacienteId, estado: "programado", pagoEstado: "pendiente",
      tarifaCobrada: 1000, fecha: new Date(Date.now() + 3 * DIA),
    },
  })).id;
  window.history.replaceState(null, "", `/pacientes/${org.pacienteId}`);
  // fetch entrega cada pedido a la RUTA de verdad.
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const pedido = new Request(`http://local${url}`, init);
    const paciente = /^\/api\/pacientes\/([^/?]+)$/.exec(url);
    if (paciente) {
      const ruta = await import("@/app/api/pacientes/[id]/route");
      const ctx = { params: Promise.resolve({ id: paciente[1] }) };
      return pedido.method === "PATCH" ? ruta.PATCH(pedido, ctx) : ruta.GET(pedido, ctx);
    }
    const consentimiento = /^\/api\/pacientes\/([^/?]+)\/consentimiento$/.exec(url);
    if (consentimiento) {
      const ruta = await import("@/app/api/pacientes/[id]/consentimiento/route");
      return ruta.GET(pedido, { params: Promise.resolve({ id: consentimiento[1] }) });
    }
    if (url === "/api/config") return (await import("@/app/api/config/route")).GET();
    throw new Error(`pedido inesperado: ${init?.method ?? "GET"} ${url}`);
  });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await limpiarOrg(estado.base.prisma, org?.orgId);
});

it("PATCH real con tarifa nueva: turnosActualizados 1 en la respuesta y el aviso en pantalla", async () => {
  const { PacienteDetailView } = await import("@/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view");
  const fetchReal = globalThis.fetch;
  const respuestas: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const res = await fetchReal(url, init);
    if (init?.method === "PATCH") respuestas.push(await res.clone().json());
    return res;
  });

  render(<PacienteDetailView id={org.pacienteId} />);
  fireEvent.click(await screen.findByRole("button", { name: /Editar datos/ }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1400" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

  expect(await screen.findByText("Tarifa guardada. Se actualizó 1 turno futuro.")).toBeTruthy();
  await waitFor(() => expect(respuestas).toHaveLength(1));
  expect(respuestas[0]).toMatchObject({ data: { id: org.pacienteId, tarifa: 1400, turnosActualizados: 1 } });
  const turno = await estado.base.prisma.turno.findUniqueOrThrow({ where: { id: turnoFuturo } });
  expect(Number(turno.tarifaCobrada)).toBe(1400);
});
