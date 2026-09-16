// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProteccionTrabajo, useProtegerTrabajo, useSalidaProtegida } from "../proteccion-trabajo";
import { IR_IGUAL, QUEDARME } from "@/lib/glosario";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
function Editor() {
  const [texto, setTexto] = useState("");
  const [pestana, setPestana] = useState("Recorrido");
  useProtegerTrabajo(texto !== "", "Hay un borrador sin guardar");
  const salir = useSalidaProtegida();
  return <><input aria-label="Borrador" value={texto} onChange={e => setTexto(e.target.value)} />
    <a href="/agenda">Agenda</a><a href="/agenda" target="_blank">Otra pestaña</a>
    <button onClick={() => salir(() => setPestana("Sesiones"))}>Cambiar pestaña</button><p>{pestana}</p></>;
}
const abrir = () => render(<ProteccionTrabajo><Editor /></ProteccionTrabajo>);
const escribir = () => fireEvent.change(screen.getByLabelText("Borrador"), { target: { value: "Texto clínico" } });
beforeEach(() => { router.push.mockClear(); history.replaceState({ __NA: true, arbol: "Next" }, "", "/pacientes/p1"); });

it("el menú pide confirmación; cancelar conserva el borrador y aceptar navega una vez", () => {
  abrir(); escribir();
  fireEvent.click(screen.getByRole("link", { name: "Agenda" }));
  expect(router.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: QUEDARME }));
  expect((screen.getByLabelText("Borrador") as HTMLInputElement).value).toBe("Texto clínico");
  fireEvent.click(screen.getByRole("link", { name: "Agenda" }));
  fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
  expect(router.push).toHaveBeenCalledExactlyOnceWith("/agenda");
});

it("cambiar de pestaña espera permiso y no desarma la protección de recarga", () => {
  abrir(); escribir();
  fireEvent.click(screen.getByRole("button", { name: "Cambiar pestaña" }));
  expect(screen.getByText("Recorrido")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
  expect(screen.getByText("Sesiones")).toBeTruthy();
  const salir = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(salir);
  expect(salir.defaultPrevented).toBe(true);
});

it("deja abrir otra pestaña sin descartar trabajo ni pedir confirmación", () => {
  abrir(); escribir();
  fireEvent.click(screen.getByRole("link", { name: "Otra pestaña" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
});

it("Atrás restaura la entrada antes de preguntar; cancelar conserva la URL y Adelante también pregunta", async () => {
  const longitud = history.length;
  abrir();
  expect(history.length).toBe(longitud);
  expect(history.state).toMatchObject({ __NA: true, arbol: "Next" });
  act(() => history.pushState({ __NA: true, arbol: "siguiente" }, "", "/sesiones/s1"));
  escribir();
  act(() => history.back());
  await screen.findByRole("alertdialog");
  expect(location.pathname).toBe("/sesiones/s1");
  fireEvent.click(screen.getByRole("button", { name: QUEDARME }));
  expect((screen.getByLabelText("Borrador") as HTMLInputElement).value).toBe("Texto clínico");
  act(() => history.back());
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
  await waitFor(() => expect(location.pathname).toBe("/pacientes/p1"));
  fireEvent.keyDown(screen.getByLabelText("Borrador"), { key: "a" });
  act(() => history.forward());
  await screen.findByRole("alertdialog");
  expect(location.pathname).toBe("/pacientes/p1");
  fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
  await waitFor(() => expect(location.pathname).toBe("/sesiones/s1"));
  expect(history.length).toBe(longitud + 1);
});

it("al desmontar devuelve los métodos de historial y no deja avisos", () => {
  const push = history.pushState;
  const replace = history.replaceState;
  const { unmount } = abrir(); escribir(); unmount();
  expect(history.pushState).toBe(push);
  expect(history.replaceState).toBe(replace);
  const salir = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(salir);
  expect(salir.defaultPrevented).toBe(false);
});

it("un salto múltiple a una entrada sin índice no adivina distancias ni cambia el editor", async () => {
  history.replaceState({ __NA: true, arbol: "login" }, "", "/login");
  history.pushState({ __NA: true, arbol: "intermedia" }, "", "/intermedia");
  history.pushState({ __NA: true, arbol: "editor" }, "", "/pacientes/p1");
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  abrir(); escribir();
  act(() => history.pushState({ __NA: true, arbol: "nota" }, "", "/sesiones/s1"));
  act(() => history.go(-3));
  await waitFor(() => expect(confirmar).toHaveBeenCalledOnce());
  expect(location.pathname).toBe("/sesiones/s1");
  expect(history.state.arbol).toBe("nota");
  expect((screen.getByLabelText("Borrador") as HTMLInputElement).value).toBe("Texto clínico");
  confirmar.mockReturnValue(true);
  act(() => history.back());
  await waitFor(() => expect(location.pathname).toBe("/login"));
  expect(confirmar).toHaveBeenCalledTimes(2);
  confirmar.mockRestore();
});
