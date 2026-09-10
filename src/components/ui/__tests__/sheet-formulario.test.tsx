// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Sheet } from "../sheet";
import estilos from "../sheet-formulario.module.css";
import { NuevoTurnoForm as FormHoy } from "@/components/forms/nuevo-turno-form";
import { NuevoTurnoForm as FormAgenda } from "@/app/(dashboard)/agenda/_components/nuevo-turno-form";
import { NuevoPacienteForm } from "@/app/(dashboard)/pacientes/_components/nuevo-paciente-form";
import { SheetNuevoTurno } from "@/app/(dashboard)/_components/sheet-nuevo-turno";

vi.mock("@/lib/api-client", async (original) => ({
  ...await original<typeof import("@/lib/api-client")>(),
  apiGet: vi.fn().mockResolvedValue([]), apiPost: vi.fn(),
}));
beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => document.querySelectorAll("style[data-prueba-layout]").forEach((n) => n.remove()));

// Compila las utilidades reales presentes en el render. No se replica a mano
// el CSS que estamos poniendo a prueba.
async function aplicarEstilos() {
  document.querySelectorAll("style[data-prueba-layout]").forEach((n) => n.remove());
  const clases = Array.from(document.querySelectorAll("[class]")).flatMap((n) => (n.getAttribute("class") ?? "").split(/\s+/));
  const compilador = await compile("@tailwind utilities;");
  const css = readFileSync(resolve(process.cwd(), "src/components/ui/sheet-formulario.module.css"), "utf8")
    .replaceAll(".contenido", `.${estilos.contenido}`);
  const estilo = document.createElement("style");
  estilo.dataset.pruebaLayout = "";
  estilo.textContent = compilador.build(clases) + "\n" + css;
  document.head.appendChild(estilo);
}
function ancestrosHasta(boton: HTMLElement, panel: HTMLElement) {
  const ancestros: HTMLElement[] = [];
  for (let nodo = boton.parentElement; nodo; nodo = nodo.parentElement) {
    ancestros.push(nodo);
    if (nodo === panel) break;
  }
  return ancestros;
}
function comprobarPanel(panel: HTMLElement) {
  const boton = within(panel).getByRole("button", { name: /^(Agendar|Crear paciente)$/, hidden: true });
  const ancestros = ancestrosHasta(boton, panel);
  const scrolls = ancestros.filter((n) => ["auto", "scroll"].includes(getComputedStyle(n).overflowY));
  expect(scrolls).toHaveLength(1);
  for (const nodo of ancestros) {
    expect(getComputedStyle(nodo).overflowY).not.toBe("hidden");
    expect(getComputedStyle(nodo).overflowX).not.toBe("hidden");
    if (nodo !== panel) expect(getComputedStyle(nodo).maxHeight).not.toBe("90vh");
  }
  const mobile = panel.classList.contains("lg:hidden");
  expect(panel.style.maxHeight).toBe(mobile ? "90dvh" : "85dvh");
  expect(getComputedStyle(boton.closest("form")!.lastElementChild!).position).toBe("static");
  const contenido = panel.querySelector<HTMLElement>(`.${estilos.contenido}`)!;
  expect(getComputedStyle(contenido).paddingBottom).toContain("safe-area-inset-bottom");
}
const pacientes = [{ id: "lucia", nombre: "Lucía", apellido: "Prueba", tarifa: 2200 }];

describe("panel de alta con un solo scroll", () => {
  it.each(["hoy", "agenda", "paciente"] as const)("mantiene los botones dentro del scroll en móvil y escritorio: %s", async (tipo) => {
    const formulario = tipo === "hoy"
      ? <FormHoy pacientes={pacientes} onSubmit={vi.fn()} onCancel={vi.fn()} />
      : tipo === "agenda"
        ? <FormAgenda pacientes={pacientes} tarifaDefault={2200} fechaInicial={new Date("2026-09-10T12:00:00-03:00")} onSubmit={vi.fn()} onCancel={vi.fn()} />
        : <NuevoPacienteForm tarifaDefault={2200} onSuccess={vi.fn()} onCancel={vi.fn()} />;
    render(<Sheet open formulario onClose={vi.fn()}>{formulario}</Sheet>);
    await aplicarEstilos();
    const paneles = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    expect(paneles).toHaveLength(2);
    paneles.forEach(comprobarPanel);
    fireEvent.submit(paneles[0].querySelector("form")!);
    await within(paneles[0]).findByText(tipo === "paciente" ? "Ingresá el nombre" : /Elegí un paciente/);
    paneles.forEach(comprobarPanel);
  });

  it.each(["hoy", "agenda"] as const)("conserva el scroll propio del selector de pacientes: %s", async (tipo) => {
    render(<Sheet open formulario onClose={vi.fn()}>
      {tipo === "hoy"
        ? <FormHoy pacientes={pacientes} onSubmit={vi.fn()} onCancel={vi.fn()} />
        : <FormAgenda pacientes={pacientes} tarifaDefault={2200} fechaInicial={null} onSubmit={vi.fn()} onCancel={vi.fn()} />}
    </Sheet>);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    fireEvent.focus(within(panel).getByLabelText("Paciente"));
    await aplicarEstilos();
    const lista = within(panel).getByRole("listbox");
    expect(getComputedStyle(lista).overflowY).toBe("auto");
    expect(getComputedStyle(lista).maxHeight).toBe("220px");
    comprobarPanel(panel);
  });

  it("activa el contenedor desde Hoy después de cargar la lista", async () => {
    const props = { open: true, onClose: vi.fn(), onSubmit: vi.fn() };
    const { rerender } = render(<SheetNuevoTurno {...props} pacientes={null} />);
    expect(document.querySelectorAll(`.${estilos.contenido}`)).toHaveLength(2);
    rerender(<SheetNuevoTurno {...props} pacientes={[]} />);
    await aplicarEstilos();
    document.querySelectorAll<HTMLElement>('[role="dialog"]').forEach(comprobarPanel);
  });

  it("no aplica el ajuste a cobros o a la ayuda", () => {
    const { rerender } = render(<Sheet open onClose={vi.fn()}><button>Cobrar</button></Sheet>);
    expect(document.querySelector(`.${estilos.contenido}`)).toBeNull();
    rerender(<Sheet open variante="lateral" onClose={vi.fn()}><input aria-label="Consultar" /></Sheet>);
    expect(document.querySelector(`.${estilos.contenido}`)).toBeNull();
  });
});
