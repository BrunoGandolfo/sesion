// @vitest-environment jsdom
//
// Desde Agenda, "Revisar nota" llevaba a una nota FALLIDA como si hubiera algo
// para revisar. Una nota fallida nunca se rotula así: dice que falló y lleva a
// ver qué pasó.
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { TurnoDetailSheet } from "../turno-detail-sheet";
import type { TurnoConPaciente } from "@/types/domain";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get, apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));
vi.mock("@/components/clinico/brief-corto", () => ({ BriefCortoDePaciente: () => null }));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("@/components/ui")>()),
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

const TURNO: TurnoConPaciente = {
  id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
  fecha: new Date("2026-10-01T15:00:00Z"), duracion: 50, modalidad: "presencial",
  estado: "realizado", tarifaCobrada: 2000, pagoEstado: "pendiente", pagoFecha: null,
  pagoMetodo: null, notas: null, creadoEn: new Date(), actualizadoEn: new Date(), sesionClinica: null,
  paciente: { id: "p1", nombre: "Lucía", apellido: "Prueba", telefono: "+59899000000" },
};

async function montar(estado: string) {
  api.get.mockImplementation((ruta: string) =>
    Promise.resolve(ruta.startsWith("/api/sesion-clinica") ? { id: "nota-1", estado } : []),
  );
  await act(async () => {
    render(<TurnoDetailSheet open turno={TURNO} onClose={vi.fn()} onUpdated={vi.fn()} />);
  });
}

beforeEach(() => vi.clearAllMocks());

it("una nota fallida dice que falló y lleva a ver qué pasó; nunca 'Revisar nota'", async () => {
  await montar("fallida");

  const enlace = await screen.findByRole("link", { name: /Nota fallida.*Ver qué pasó/ });
  expect(enlace.getAttribute("href")).toBe("/sesiones/nota-1");
  expect(screen.queryByText("Revisar nota")).toBeNull();
  // El pago sigue diciéndose aparte, en sus propias palabras.
  expect(screen.getAllByText("Sin cobrar").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
});

it.each([
  ["revision", "Para revisar"],
  ["aprobada", "Nota lista"],
])("la nota %s se rotula '%s'", async (estado, rotulo) => {
  await montar(estado);
  const enlace = await screen.findByRole("link", { name: new RegExp(rotulo) });
  expect(enlace.getAttribute("href")).toBe("/sesiones/nota-1");
});
