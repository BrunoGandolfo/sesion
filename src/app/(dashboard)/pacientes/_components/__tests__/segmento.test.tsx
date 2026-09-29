// @vitest-environment jsdom
//
// Al pasar de Activos a Archivados, mientras llega la lista nueva, los
// pacientes activos que siguen en pantalla no ofrecen "Reactivar": un toque
// ahí los habría reactivado (ya estaban activos) y sacado de la lista.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PacientesView } from "../pacientes-view";

const m = vi.hoisted(() => ({ get: vi.fn<(url: string) => Promise<unknown>>() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
  apiPatch: vi.fn(),
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const ANA = {
  id: "p1", nombre: "Ana", apellido: "López", telefono: "+59899111222", tarifa: 2000, notas: null,
  activo: true, organizationId: "org", creadoEn: "2026-09-01T00:00:00.000Z",
  actualizadoEn: "2026-09-01T00:00:00.000Z", ultimaSesion: null, sesionesRealizadas: 3,
  totalCobrado: 6000, sesionesImpagas: 0, deudaTotal: 0,
};

it("mientras llegan los archivados, los activos en pantalla no ofrecen Reactivar", async () => {
  let entregarArchivados: (lista: unknown[]) => void = () => {};
  m.get.mockImplementation(async (url: string) => {
    if (url.includes("activo=false") || url.includes("archivados")) {
      return new Promise((resolver) => { entregarArchivados = resolver; });
    }
    return [ANA];
  });
  render(<PacientesView />);
  expect((await screen.findAllByText(/López/)).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("tab", { name: "Archivados" }));
  await act(async () => {});
  expect(screen.queryAllByRole("button", { name: /Reactivar/ })).toHaveLength(0);

  await act(async () => entregarArchivados([{ ...ANA, id: "p2", apellido: "Pérez", activo: false }]));
  expect((await screen.findAllByRole("button", { name: /Reactivar/ })).length).toBeGreaterThan(0);
});
