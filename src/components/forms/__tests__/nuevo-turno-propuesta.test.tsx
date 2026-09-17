// @vitest-environment jsdom

// La propuesta de día y hora se calcula con el último turno del paciente y
// llega después de elegirlo: mientras el pedido viaja, la profesional ya está
// escribiendo. Lo que escribió manda; la propuesta se muestra igual, abajo de
// los campos.
//
// Sin fechas escritas a mano: todo se arma desde el reloj real, como el pedido
// que hace el formulario.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  NuevoTurnoForm,
  proponerDesdeUltimoTurno,
} from "@/components/forms/nuevo-turno-form";
import {
  agregarDiasMvd,
  fechaInputMvd,
  horaInputMvd,
} from "@/lib/fechas-montevideo";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

const PACIENTES = [{ id: "p1", nombre: "Lucía", apellido: "Ferreira", tarifa: 2500 }];

/** Hace una semana: la propuesta cae en la semana que viene, a esta hora. */
const ULTIMO_TURNO = agregarDiasMvd(new Date(), -7);
const propuesta = () => proponerDesdeUltimoTurno(ULTIMO_TURNO, new Date());

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

function campos() {
  return {
    fecha: screen.getByLabelText("Fecha") as HTMLInputElement,
    hora: screen.getByLabelText("Hora") as HTMLInputElement,
  };
}

/** El pedido del último turno, con su respuesta en la mano de la prueba. */
function consultaEnVuelo() {
  let responder: (turnos: { fecha: string }[]) => void = () => {};
  api.get.mockImplementation(
    () => new Promise((resolve) => { responder = resolve; }),
  );
  return {
    async responderCon(turnos: { fecha: string }[]) {
      await act(async () => { responder(turnos); });
    },
  };
}

it("lo que escribió la profesional mientras viajaba la consulta no se pisa, y la propuesta se muestra igual", async () => {
  const consulta = consultaEnVuelo();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<NuevoTurnoForm pacientes={PACIENTES} onSubmit={onSubmit} onCancel={vi.fn()} />);

  await elegirPaciente();

  // Escribe un día y una hora distintos de lo que va a proponer la respuesta.
  const fechaEscrita = fechaInputMvd(agregarDiasMvd(new Date(), 3));
  const horaPropuesta = horaInputMvd(propuesta());
  const horaEscrita = horaPropuesta === "16:45" ? "09:15" : "16:45";
  const { fecha, hora } = campos();
  await act(async () => {
    fireEvent.change(fecha, { target: { value: fechaEscrita } });
    fireEvent.change(hora, { target: { value: horaEscrita } });
  });

  await consulta.responderCon([{ fecha: ULTIMO_TURNO.toISOString() }]);

  expect(campos().fecha.value).toBe(fechaEscrita);
  expect(campos().hora.value).toBe(horaEscrita);
  // La propuesta sigue a la vista: se ofrece, no se impone.
  expect(screen.getByText(/Propuesto desde el último turno de Lucía/)).toBeTruthy();

  // Y es lo escrito lo que se agenda.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
  });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ fecha: fechaEscrita, hora: horaEscrita });
});

it("sin tocar nada, la propuesta se aplica como siempre", async () => {
  const consulta = consultaEnVuelo();
  render(<NuevoTurnoForm pacientes={PACIENTES} onSubmit={vi.fn()} onCancel={vi.fn()} />);

  await elegirPaciente();
  await consulta.responderCon([{ fecha: ULTIMO_TURNO.toISOString() }]);

  const sugerida = propuesta();
  expect(campos().fecha.value).toBe(fechaInputMvd(sugerida));
  expect(campos().hora.value).toBe(horaInputMvd(sugerida));
});

it("tocar sólo la hora tampoco deja que la propuesta pise la fecha", async () => {
  const consulta = consultaEnVuelo();
  render(<NuevoTurnoForm pacientes={PACIENTES} onSubmit={vi.fn()} onCancel={vi.fn()} />);

  await elegirPaciente();
  const fechaAntes = campos().fecha.value;
  const horaPropuesta = horaInputMvd(propuesta());
  const horaEscrita = horaPropuesta === "08:20" ? "11:40" : "08:20";
  await act(async () => {
    fireEvent.change(campos().hora, { target: { value: horaEscrita } });
  });

  await consulta.responderCon([{ fecha: ULTIMO_TURNO.toISOString() }]);

  expect(campos().hora.value).toBe(horaEscrita);
  expect(campos().fecha.value).toBe(fechaAntes);
});
