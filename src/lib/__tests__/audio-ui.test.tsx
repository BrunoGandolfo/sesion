// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GrabarView } from "@/app/(dashboard)/grabar/[turnoId]/_components/grabar-view";
const m = vi.hoisted(() => ({ vista: {} as Record<string, unknown>, iniciar: vi.fn(), terminar: vi.fn(), reenviar: vi.fn() }));
vi.mock("@/hooks/useAudioGrabacion", () => ({ useAudioGrabacion: () => ({ lista: true, ocupada: false, segundos: 60, mensaje: "", error: null, ...m.vista, iniciar: m.iniciar, terminar: m.terminar, reenviar: m.reenviar }) }));
const props = { turnoId: "t", cuenta: "c", organizationId: "o", pacienteId: "p", pacienteNombre: "Paciente sintética", autorizacionVigente: true, horaTexto: "12:00" };
afterEach(() => { cleanup(); m.vista = {}; vi.clearAllMocks(); });
test("una grabación pendiente ofrece recuperar, nunca empezar encima", () => {
  m.vista = { grabacion: { estado: "interrumpida", sesionId: "s" } };
  render(<GrabarView {...props} />);
  expect(screen.queryByRole("button", { name: "Grabar sesión" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Terminar y enviar" }));
  expect(m.terminar).toHaveBeenCalledOnce();
});
test("una respuesta incierta dice que conserva la copia y permite comprobar", () => {
  m.vista = { grabacion: { estado: "cerrada", sesionId: "s" }, error: "No pudimos confirmar el envío. La copia cifrada se conserva y se reintentará." };
  render(<GrabarView {...props} />);
  expect(screen.getByRole("alert").textContent).toContain("copia cifrada se conserva");
  expect(screen.queryByText(/no se guardó/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Comprobar y reintentar envío" }));
  expect(m.reenviar).toHaveBeenCalledOnce();
});
test("al límite espera la decisión de la profesional", () => {
  m.vista = { grabacion: { estado: "pausada", sesionId: "s" }, segundos: 9000 };
  render(<GrabarView {...props} />);
  expect((screen.getByRole("button", { name: "Reanudar grabación" }) as HTMLButtonElement).disabled).toBe(true);
  expect(m.terminar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Terminar y enviar" }));
  expect(m.terminar).toHaveBeenCalledOnce();
});
