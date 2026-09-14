// @vitest-environment jsdom

// El único formulario de turno ofrece la repetición y la entrega en los
// datos que recibe quien lo monta (Hoy y Agenda). Por defecto es un turno
// solo, como siempre.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NuevoTurnoForm } from "@/components/forms/nuevo-turno-form";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

const PACIENTES = [{ id: "p1", nombre: "Lucía", apellido: "Ferreira", tarifa: 2500 }];

async function elegirPaciente() {
  const buscador = screen.getByLabelText("Paciente");
  await act(async () => {
    fireEvent.focus(buscador);
    fireEvent.change(buscador, { target: { value: "Luc" } });
  });
  const opcion = await screen.findByRole("option", { name: /Lucía Ferreira/ });
  await act(async () => {
    fireEvent.click(opcion);
  });
}

describe("NuevoTurnoForm: se repite", () => {
  it("por defecto agenda una vez, y lo dice en los datos", async () => {
    api.get.mockResolvedValue([]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NuevoTurnoForm pacientes={PACIENTES} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Una vez", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cada semana" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cada 15 días" })).toBeTruthy();

    await elegirPaciente();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ pacienteId: "p1", frecuencia: "unico" });
  });

  it("elegir 'Cada semana' explica la serie y viaja en los datos", async () => {
    api.get.mockResolvedValue([]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NuevoTurnoForm pacientes={PACIENTES} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Cada semana" }));
    });
    expect(screen.getByText(/tres meses de turnos, cada uno independiente/)).toBeTruthy();

    await elegirPaciente();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ frecuencia: "semanal" });
  });
});
