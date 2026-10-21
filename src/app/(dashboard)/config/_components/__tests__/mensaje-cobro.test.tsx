// @vitest-environment jsdom
// La plantilla del aviso de cobro en Tu consultorio: se edita con fichas,
// la vista previa es el texto que le llega a la paciente y se autoguarda.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_COBRO_DEFAULT, textoDelCobro } from "@/lib/deudas";
import { COBRO_MENSAJE_EDITOR, COBRO_VISTA_PREVIA } from "@/lib/glosario";

import { ConfigView } from "../config-view";
import { MensajeCobro } from "../mensaje-cobro";

const api = vi.hoisted(() => ({ patch: vi.fn(), config: {} as Record<string, unknown> }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPatch: api.patch,
  apiGet: async () => api.config,
}));
vi.mock("@/components/layout/cabecera-usuario", () => ({ AccesoConsultorio: () => null }));
vi.mock("../vocabulario-seccion", () => ({ VocabularioSeccion: () => null }));
vi.mock("../invitar-colega", () => ({ InvitarColega: () => null }));

const datos = { profesional: "Mariana Roldán", direccion: "Calle 123", telefono: "+59899123456" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MensajeCobro", () => {
  it("la plantilla de siempre ida y vuelta por el editor queda igual, y la vista previa es el texto real", () => {
    const onChange = vi.fn();
    render(<MensajeCobro {...datos} template={TEMPLATE_COBRO_DEFAULT} onChange={onChange} />);
    const editor = screen.getByRole("textbox", { name: COBRO_MENSAJE_EDITOR });
    // "{{sesiones}} sesión/es pendiente/s" es UNA ficha, no llaves y barras.
    expect(editor.textContent).toContain("Sesiones pendientes");
    expect(editor.textContent).not.toContain("sesión/es");
    fireEvent.input(editor);
    expect(onChange).toHaveBeenCalledWith(TEMPLATE_COBRO_DEFAULT);
    expect(screen.getByRole("region", { name: COBRO_VISTA_PREVIA }).textContent).toBe(
      textoDelCobro(
        { templateCobro: TEMPLATE_COBRO_DEFAULT, nombreProfesional: datos.profesional, direccion: datos.direccion, whatsappOrigen: datos.telefono },
        { nombre: "Lucía", apellido: "Fernández" },
        { sesiones: 2, monto: 2400 },
      ),
    );
  });

  it("vacía, avisa", () => {
    render(<MensajeCobro {...datos} template="  " onChange={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/no puede quedar vacío/);
  });
});

describe("Tu consultorio guarda la plantilla de cobro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.patch.mockReset();
    api.patch.mockResolvedValue({});
    api.config = {
      nombreProfesional: "Mariana Roldán",
      direccion: "Calle 123",
      whatsappOrigen: "099123456",
      tarifaDefault: 1500,
      recordatorioModo: "dia_anterior",
      templateRecordatorio: "Hola {{nombre}}",
      templateCobro: "Hola {{nombre}}, debés {{monto}}.",
      orientacionTeorica: "gestalt",
    };
  });

  it("muestra la guardada y autoguarda el cambio", async () => {
    await act(async () => {
      render(<ConfigView />);
    });
    const editor = screen.getByRole("textbox", { name: COBRO_MENSAJE_EDITOR });
    expect(editor.textContent).toBe("Hola Nombre, debés Monto.");
    editor.appendChild(document.createTextNode(" Gracias."));
    fireEvent.input(editor);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.patch).toHaveBeenCalledWith("/api/config", { templateCobro: "Hola {{nombre}}, debés {{monto}}. Gracias." });
  });
});
