// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { QUEDARME } from "@/lib/glosario";
import { HiloView } from "../HiloView";
import { apiGet, apiPost, ApiClientError } from "@/lib/api-client";
import { hiloVacio, type Recorrido, type VersionHilo } from "@/lib/hilo/contenido";

vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
const version = (n: number, resumen: string): VersionHilo => ({
  id: `version-${n}`, version: n, basadaEnVersion: n - 1 || null, actor: "profesional", estado: "aplicada", sesionOrigenId: null,
  creadaPorUserId: "u", creadaEn: "2026-09-01T15:00:00Z", resueltaEn: null, resueltaPorUserId: null, propuestaOrigenId: null,
  contenido: { ...hiloVacio(), resumenAcumulativo: resumen },
});
const recorrido = (): Recorrido => {
  const vigente = version(1, "Mi historia revisada");
  return { pacienteId: "p1", vigente, propuesta: { ...version(2, "Nueva información"), actor: "ia", estado: "propuesta", contenido: { ...hiloVacio(), resumenAcumulativo: "Nueva información", cambios: ["Agrega la nueva sesión"] } }, historial: [vigente], desactualizadas: [], hayMas: false, totalSesionesAprobadas: 1, sesionesAprobadas: [], trabajos: [] };
};
beforeEach(() => { vi.mocked(apiGet).mockReset().mockResolvedValue(recorrido()); vi.mocked(apiPost).mockReset().mockResolvedValue({}); });

it("muestra la vigente, compara la propuesta y acepta con la versión leída", async () => {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  await screen.findByText("Mi historia revisada");
  expect(screen.queryByText("Nueva información")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ver propuesta" }));
  expect(screen.getByText("Nueva información")).toBeTruthy();
  expect(screen.getAllByText("Con cambios").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/pacientes/p1/hilo/propuestas/version-2/aceptar", { basadaEnVersion: 1 }));
});

it("editar y aceptar envía una versión completa distinta de la propuesta", async () => {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar y aceptar" }));
  fireEvent.change(screen.getByRole("textbox", { name: "El recorrido hasta hoy" }), { target: { value: "Revisado por mí" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar y aceptar" }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/pacientes/p1/hilo/propuestas/version-2/aceptar", expect.objectContaining({ basadaEnVersion: 1, contenido: expect.objectContaining({ resumenAcumulativo: "Revisado por mí" }) })));
});

it("rechazar no modifica la vigente y manda la propuesta correcta", async () => {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  fireEvent.click(await screen.findByRole("button", { name: "Descartar propuesta" }));
  expect(apiPost).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Descartar propuesta" }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/pacientes/p1/hilo/propuestas/version-2/rechazar", { basadaEnVersion: 1 }));
});

it("un 409 conserva el borrador y exige leer la vigente antes de guardar de nuevo", async () => {
  vi.mocked(apiPost).mockRejectedValueOnce(new ApiClientError("El Recorrido cambió", 409));
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar Recorrido" }));
  const campo = screen.getByRole("textbox", { name: "El recorrido hasta hoy" }) as HTMLTextAreaElement;
  fireEvent.change(campo, { target: { value: "Borrador que no se debe perder" } });
  vi.mocked(apiGet).mockResolvedValue({ ...recorrido(), vigente: version(3, "Guardada en otra pestaña"), propuesta: null });
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva versión" }));
  await screen.findByText("Guardada en otra pestaña");
  expect(campo.value).toBe("Borrador que no se debe perder");
  expect((screen.getByRole("button", { name: "Guardar nueva versión" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Ya leí la versión actual/ }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva versión" }));
  await waitFor(() => expect(vi.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ basadaEnVersion: 3, contenido: { resumenAcumulativo: "Borrador que no se debe perder" } }));
});

it("leer y restaurar una versión histórica crea un borrador, sin sobrescribirla", async () => {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  await screen.findByText("Mi historia revisada");
  vi.mocked(apiGet).mockResolvedValueOnce(version(1, "Contenido histórico"));
  fireEvent.click(screen.getByRole("button", { name: /Versión 1/ }));
  await screen.findByText("Contenido histórico");
  fireEvent.click(screen.getByRole("button", { name: "Usar como borrador de una versión nueva" }));
  expect(apiPost).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva versión" }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/pacientes/p1/hilo/versiones", expect.objectContaining({ basadaEnVersion: 1 })));
});

it("cancelar un borrador pregunta y Quedarme conserva lo escrito", async () => {
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar Recorrido" }));
  fireEvent.change(screen.getByLabelText("El recorrido hasta hoy"), { target: { value: "Trabajo sin guardar" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: QUEDARME }));
  expect((screen.getByLabelText("El recorrido hasta hoy") as HTMLTextAreaElement).value).toBe("Trabajo sin guardar");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));
  fireEvent.click(screen.getByRole("button", { name: "Descartar borrador" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apiPost).not.toHaveBeenCalled();
});
it("el error de carga reemplaza la espera y permite recuperarse", async () => {
  vi.mocked(apiGet).mockRejectedValueOnce(new Error("Sin conexión"));
  render(<ProteccionTrabajo><HiloView pacienteId="p1" /></ProteccionTrabajo>);
  await screen.findByRole("alert");
  expect(screen.queryByText("Cargando Recorrido…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
  await screen.findByText("Mi historia revisada");
  expect(screen.queryByRole("alert")).toBeNull();
});
