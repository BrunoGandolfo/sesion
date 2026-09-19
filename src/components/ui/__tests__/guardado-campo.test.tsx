// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigView } from "@/app/(dashboard)/config/_components/config-view";
import { NotasEditor } from "@/app/(dashboard)/pacientes/[id]/_components/ficha-tab";
const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api-client", async original => ({
  ...await original<typeof import("@/lib/api-client")>(), apiGet: api.get, apiPatch: api.patch,
}));
vi.mock("@/components/layout/providers", () => ({ useSesionActual: () => null }));
vi.mock("@/app/(dashboard)/config/_components/vocabulario-seccion", () => ({ VocabularioSeccion: () => null }));
vi.mock("@/app/(dashboard)/config/_components/invitar-colega", () => ({ InvitarColega: () => null }));
vi.mock("@/components/grabacion/ConsentimientoBadge", () => ({ ConsentimientoBadge: () => null }));
vi.mock("@/components/grabacion/HotWordsManager", () => ({ HotWordsManager: () => null }));
const config = { nombreProfesional:"Mariana", direccion:"Calle 1", whatsappOrigen:"+59899123456", tarifaDefault:2000, orientacionTeorica:"cbt_mi", recordatorioModo:"dia_anterior", templateRecordatorio:"Hola {{nombre}}" };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); api.get.mockResolvedValue(config); api.patch.mockResolvedValue(config); });
afterEach(() => vi.useRealTimers());
async function montarConfig() { await act(async () => { render(<ConfigView />); }); }
function juntoAlCampo(label: string) { return within(screen.getByLabelText(label).parentElement!.parentElement!.parentElement!); }
it("en configuración muestra pendiente, guardando y guardado solo junto al campo editado", async () => {
  let resolver!: (v: unknown) => void;
  api.patch.mockReturnValue(new Promise(r => { resolver = r; }));
  await montarConfig();
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:"Mariana Nueva"}});
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toBe("Sin guardar todavía.");
  expect(juntoAlCampo("Dirección del consultorio").queryByRole("status")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toBe("Guardando…");
  await act(async () => { resolver(config); });
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toBe("Guardado.");
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:"Otro nombre"}});
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toBe("Sin guardar todavía.");
});
it("un campo inválido no frena a los demás: se guardan y solo él queda sin guardar", async () => {
  await montarConfig();
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:""}});
  fireEvent.change(screen.getByLabelText("Dirección del consultorio"), {target:{value:"Otra calle"}});
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(api.patch).toHaveBeenCalledExactlyOnceWith("/api/config", {direccion:"Otra calle"});
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toMatch(/No se guardó/);
  expect(juntoAlCampo("Dirección del consultorio").getByRole("status").textContent).toBe("Guardado.");
});
it("la ficha confirma después de la respuesta y deja de decir Guardado al volver a escribir", async () => {
  const onSaved = vi.fn();
  render(<NotasEditor pacienteId="p1" initial="" onSaved={onSaved} />);
  const campo = screen.getByLabelText("Notas privadas del paciente");
  fireEvent.change(campo, {target:{value:"Nota de prueba"}});
  expect(screen.getByRole("status").textContent).toBe("Sin guardar todavía.");
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(api.patch).toHaveBeenCalledWith("/api/pacientes/p1", {notas:"Nota de prueba"});
  expect(screen.getByRole("status").textContent).toBe("Guardado.");
  expect(campo.getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
  fireEvent.change(campo,{target:{value:"Nota nueva"}});
  expect(screen.getByRole("status").textContent).toBe("Sin guardar todavía.");
});

it("una respuesta en vuelo no confirma el valor escrito después de enviar", async () => {
  let resolver!: (v: unknown) => void;
  api.patch.mockReturnValue(new Promise(r => { resolver = r; }));
  await montarConfig();
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:"Primer nombre"}});
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  fireEvent.change(screen.getByLabelText("Nombre"), {target:{value:"Segundo nombre"}});
  await act(async () => { resolver(config); });
  expect(juntoAlCampo("Nombre").getByRole("status").textContent).toBe("Sin guardar todavía.");
});
