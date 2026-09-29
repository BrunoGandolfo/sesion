// @vitest-environment jsdom
//
// El formulario de la autorización y el lienzo de la firma, de verdad (forense
// 03, P3-27): la paciente lee, marca, firma con el dedo o el mouse, y Firmar
// manda la firma con la versión VIGENTE del texto.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { CONSENTIMIENTO_VERSION } from "@/lib/consentimiento";

import { ConsentimientoForm } from "../ConsentimientoForm";
import { FirmaCanvas } from "../FirmaCanvas";

const m = vi.hoisted(() => ({ post: vi.fn(), ctx: null as null | Record<string, unknown>, resize: null as null | (() => void) }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPost: (...a: unknown[]) => m.post(...a),
}));

const FIRMA = "data:image/png;base64,FIRMA";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: () => void) { m.resize = cb; }
    observe() {}
    disconnect() {}
  });
  // jsdom no dibuja: un contexto 2D de mentira alcanza para seguir el trazo.
  HTMLCanvasElement.prototype.getContext = function () {
    m.ctx ??= {
      setTransform: vi.fn(), scale: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    };
    return m.ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => FIRMA;
  Element.prototype.getBoundingClientRect = function () {
    return { width: 320, height: 200, left: 10, top: 20, right: 330, bottom: 220, x: 10, y: 20, toJSON() {} } as DOMRect;
  };
});
beforeEach(() => { m.post.mockReset(); m.ctx = null; });
afterEach(cleanup);

function lienzo() {
  return screen.getByRole("img", { name: "Lienzo para tu firma" });
}

function firmarConMouse() {
  const c = lienzo();
  fireEvent.mouseDown(c, { clientX: 20, clientY: 30 });
  fireEvent.mouseMove(c, { clientX: 60, clientY: 70 });
  fireEvent.mouseUp(c);
}

function montarForm(extra: Partial<Parameters<typeof ConsentimientoForm>[0]> = {}) {
  const props = {
    pacienteId: "p1",
    nombrePaciente: "María González",
    nombreProfesional: "Lic. Ana Pérez",
    direccionConsultorio: "Av. 18 de Julio 1234",
    onConsentimientoFirmado: vi.fn(),
    onCancelar: vi.fn(),
    ...extra,
  };
  render(<ConsentimientoForm {...props} />);
  return props;
}

describe("ConsentimientoForm", () => {
  it("muestra el texto vigente, con su nombre y su versión", () => {
    montarForm();
    const texto = screen.getByRole("region", { name: "Texto de la autorización" }).textContent ?? "";
    expect(texto).toContain("Hola María González.");
    expect(texto).toContain(`Versión ${CONSENTIMIENTO_VERSION}`);
  });

  it("Firmar no se habilita hasta leer Y firmar; manda POST con la firma y la versión vigente", async () => {
    m.post.mockResolvedValue({ consentimiento: {} });
    const props = montarForm();
    const firmar = screen.getByRole("button", { name: "Firmar" }) as HTMLButtonElement;
    expect(firmar.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Leí y entiendo la información anterior" }));
    expect(firmar.disabled).toBe(true);
    firmarConMouse();
    expect(firmar.disabled).toBe(false);

    fireEvent.click(firmar);
    await waitFor(() => expect(props.onConsentimientoFirmado).toHaveBeenCalledOnce());
    expect(m.post).toHaveBeenCalledWith("/api/pacientes/p1/consentimiento", {
      firmaDigital: FIRMA,
      textoVersion: CONSENTIMIENTO_VERSION,
    });
    expect(CONSENTIMIENTO_VERSION).toBe("2.8");
  });

  it("si el servidor rechaza, lo dice en palabras de ella y no da por firmado", async () => {
    m.post.mockRejectedValue(new ApiClientError("La paciente no existe", 404));
    const props = montarForm();
    fireEvent.click(screen.getByRole("checkbox"));
    firmarConMouse();
    fireEvent.click(screen.getByRole("button", { name: "Firmar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(props.onConsentimientoFirmado).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Firmar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Borrar firma vuelve a deshabilitar Firmar; Cancelar avisa", () => {
    const props = montarForm();
    fireEvent.click(screen.getByRole("checkbox"));
    firmarConMouse();
    fireEvent.click(screen.getByRole("button", { name: "Borrar firma" }));
    expect((screen.getByRole("button", { name: "Firmar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(props.onCancelar).toHaveBeenCalledOnce();
  });
});

describe("FirmaCanvas", () => {
  it("con el dedo: toca, arrastra y levanta; la firma sale al levantar", () => {
    const onFirmaChange = vi.fn();
    render(<FirmaCanvas onFirmaChange={onFirmaChange} />);
    const c = lienzo();
    fireEvent.touchStart(c, { touches: [{ clientX: 30, clientY: 40 }] });
    fireEvent.touchMove(c, { touches: [{ clientX: 50, clientY: 60 }] });
    fireEvent.touchEnd(c, { touches: [], changedTouches: [{ clientX: 50, clientY: 60 }] });
    expect(onFirmaChange).toHaveBeenCalledWith(FIRMA);
    // El punto se ubica relativo al lienzo (left 10, top 20).
    expect(m.ctx?.arc).toHaveBeenCalledWith(20, 20, 1, 0, Math.PI * 2);
    expect(m.ctx?.lineTo).toHaveBeenCalledWith(40, 40);
  });

  it("mover sin haber tocado no dibuja; un toque sin puntos no empieza nada", () => {
    const onFirmaChange = vi.fn();
    render(<FirmaCanvas onFirmaChange={onFirmaChange} />);
    const c = lienzo();
    fireEvent.mouseMove(c, { clientX: 60, clientY: 70 });
    fireEvent.touchStart(c, { touches: [], changedTouches: [] });
    fireEvent.mouseUp(c);
    expect(m.ctx?.stroke).not.toHaveBeenCalled();
    expect(onFirmaChange).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Borrar firma" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("salir del lienzo con el mouse apretado termina el trazo", () => {
    const onFirmaChange = vi.fn();
    render(<FirmaCanvas onFirmaChange={onFirmaChange} />);
    const c = lienzo();
    fireEvent.mouseDown(c, { clientX: 20, clientY: 30 });
    fireEvent.mouseLeave(c);
    expect(onFirmaChange).toHaveBeenCalledWith(FIRMA);
  });

  it("si cambia el tamaño con una firma hecha, la conserva; Borrar la limpia y avisa null", () => {
    const onFirmaChange = vi.fn();
    render(<FirmaCanvas onFirmaChange={onFirmaChange} />);
    firmarConMouse();
    const antes = (m.ctx?.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
    m.resize?.();
    expect((m.ctx?.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(antes + 1);
    fireEvent.click(screen.getByRole("button", { name: "Borrar firma" }));
    expect(onFirmaChange).toHaveBeenLastCalledWith(null);
  });
});
