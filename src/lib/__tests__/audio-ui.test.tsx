// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GrabarView } from "@/app/(dashboard)/grabar/[turnoId]/_components/grabar-view";
import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { QUEDARME, PREPARANDO_GRABACION, PRUEBA_AVISO, PRUEBA_CERCA, PRUEBA_TOPE } from "@/lib/glosario";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
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

test("consultorio de prueba: desde el principio dice el tope, avisa cerca y en el tope no deja empezar otra", () => {
  const { rerender } = render(<GrabarView {...props} prueba={{ usadas: 0, restantes: 15, tope: 15 }} />);
  expect(screen.getByText(PRUEBA_AVISO(0))).toBeTruthy();
  expect(screen.queryByText(PRUEBA_CERCA(3))).toBeNull();

  rerender(<GrabarView {...props} prueba={{ usadas: 12, restantes: 3, tope: 15 }} />);
  expect(screen.getByText(PRUEBA_CERCA(3))).toBeTruthy();
  expect((screen.getByRole("button", { name: "Grabar sesión" }) as HTMLButtonElement).disabled).toBe(false);

  rerender(<GrabarView {...props} prueba={{ usadas: 15, restantes: 0, tope: 15 }} />);
  expect(screen.getByRole("alert").textContent).toContain(PRUEBA_TOPE);
  expect((screen.getByRole("button", { name: "Grabar sesión" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Grabar sesión" }));
  expect(m.iniciar).not.toHaveBeenCalled();
});

test("en el tope, la grabación ya empezada se puede reanudar; sin prueba no hay aviso", () => {
  m.vista = { grabacion: { estado: "pausada", sesionId: "s" } };
  const { rerender } = render(<GrabarView {...props} prueba={{ usadas: 15, restantes: 0, tope: 15 }} />);
  expect((screen.getByRole("button", { name: "Reanudar grabación" }) as HTMLButtonElement).disabled).toBe(false);
  rerender(<GrabarView {...props} prueba={null} />);
  expect(screen.queryByText(/Estás probando Sesión/)).toBeNull();
});

test("explica por qué todavía no se puede empezar", () => {
  m.vista = { lista: false };
  render(<GrabarView {...props} />);
  expect(screen.getByText(PREPARANDO_GRABACION)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Grabar sesión" }) as HTMLButtonElement).disabled).toBe(true);
});
test("salir durante la captura pregunta; quedarse no termina ni reenvía", () => {
  m.vista = { grabacion: { estado: "capturando", sesionId: "s" } };
  render(<ProteccionTrabajo><GrabarView {...props} /></ProteccionTrabajo>);
  fireEvent.click(screen.getByRole("link", { name: "Volver a la ficha" }));
  expect(screen.getByRole("alertdialog").textContent).toContain("la captura se pausa");
  fireEvent.click(screen.getByRole("button", { name: QUEDARME }));
  expect(screen.getByRole("button", { name: "Pausar" })).toBeTruthy();
  expect(m.terminar).not.toHaveBeenCalled();
  expect(m.reenviar).not.toHaveBeenCalled();
});

test("el medidor acompaña la captura y advierte cuando no entra sonido", () => {
  m.vista = { grabacion: { estado: "capturando" }, nivelAudio: 0.5, silencioso: false };
  const { rerender } = render(<GrabarView {...props} />);
  expect(screen.getByText("El audio se escucha bien")).toBeTruthy();
  m.vista.silencioso = true;
  rerender(<GrabarView {...props} />);
  expect(screen.getByText("No está entrando sonido")).toBeTruthy();
  m.vista.grabacion = { estado: "pausada" };
  rerender(<GrabarView {...props} />);
  expect(screen.queryByText("No está entrando sonido")).toBeNull();
});
