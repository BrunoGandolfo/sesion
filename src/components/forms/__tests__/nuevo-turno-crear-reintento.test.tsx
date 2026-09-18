// @vitest-environment jsdom

// "Crear a X" crea el paciente recién al tocar Agendar. Si el turno se
// rechaza —un 409 porque el horario choca— y ella cambia la hora y vuelve a
// tocar Agendar, el paciente ya existe: se reusa. Antes cada reintento creaba
// otro con el mismo nombre.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { NuevoTurnoForm } from "@/components/forms/nuevo-turno-form";
import { ApiClientError } from "@/lib/api-client";
import { TURNO_SOLAPADO_CON } from "@/lib/glosario";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

it("tras un 409, reenviar con otra hora no vuelve a crear el paciente y usa el mismo id", async () => {
  api.post
    .mockResolvedValueOnce({ id: "creado-1" })
    .mockResolvedValue({ id: "creado-2" });
  const rechazo = TURNO_SOLAPADO_CON("Lucía Fernández", "10:00", "10:50");
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce(new ApiClientError(rechazo, 409))
    .mockResolvedValue(undefined);
  render(
    <NuevoTurnoForm pacientes={[]} tarifaDefault={2000} onSubmit={onSubmit} onCancel={vi.fn()} />,
  );

  const buscador = screen.getByLabelText("Paciente");
  await act(async () => {
    fireEvent.focus(buscador);
    fireEvent.change(buscador, { target: { value: "Zoe Prueba" } });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("option", { name: /Crear a Zoe Prueba/ }));
  });
  fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "+59899123456" } });
  fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "10:30" } });

  const agendar = screen.getByRole("button", { name: "Agendar" });
  await act(async () => {
    fireEvent.click(agendar);
  });
  expect(await screen.findByText(rechazo)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "15:00" } });
  await act(async () => {
    fireEvent.click(agendar);
  });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

  const altas = api.post.mock.calls.filter(([ruta]) => ruta === "/api/pacientes");
  expect(altas).toHaveLength(1);
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ pacienteId: "creado-1", hora: "10:30" });
  expect(onSubmit.mock.calls[1][0]).toMatchObject({ pacienteId: "creado-1", hora: "15:00" });
});
