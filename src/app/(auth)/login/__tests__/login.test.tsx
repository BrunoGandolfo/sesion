// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea es lo que lo hace correr
// en un DOM.
//
// Lo que se protege acá son dos cosas distintas:
//
//  1. Que la pantalla de entrada siga diciendo qué es esto. Era un formulario
//     sin nombre ni presencia; el riesgo de una pantalla que nadie mira
//     después de entrar es que alguien la vuelva a vaciar sin notarlo.
//  2. Que agregarle presencia no haya roto el formulario. Es la única puerta
//     de la app: si los campos pierden su nombre accesible o el botón deja de
//     ser un botón, nadie entra. Se consulta por rol y por nombre —lo que ve
//     y toca quien usa la pantalla—, nunca por clase ni por id.
//
// Entrar es un POST a /api/cuenta/entrar; acá solo se monta la página, y el
// router de Next se dobla.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => router,
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

import LoginPage from "@/app/(auth)/login/page";
import {
  PORTADA_FUNCIONES,
  PORTADA_FUNCIONES_TITULO,
  PORTADA_LUPITA,
  PORTADA_LUPITA_CUIDADO,
  ENTRADA_CONFIDENCIALIDAD,
  ENTRADA_CONTRASENA,
  ENTRADA_EMAIL,
  ENTRADA_QUE_HACE,
  ENTRAR,
  ENTRANDO,
  ENTRADA_ERROR,
  ESLOGAN,
  NOMBRE_PRODUCTO,
} from "@/lib/glosario";

describe("Pantalla de entrada", () => {
  it("presenta la app antes de las credenciales y deja el detalle de funciones después del formulario", () => {
    render(<LoginPage />);
    const formulario = screen.getByLabelText(ENTRADA_EMAIL).closest("form")!;
    const explicacion = screen.getByText(ENTRADA_QUE_HACE);
    expect(explicacion.compareDocumentPosition(formulario) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const detalle = screen.getByRole("heading", { name: PORTADA_FUNCIONES_TITULO });
    expect(formulario.compareDocumentPosition(detalle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const enlace of screen.getAllByRole("link", { name: ENTRAR })) {
      expect(enlace.getAttribute("href")).toBe("#ingresar");
      expect(document.querySelector("#ingresar")?.contains(formulario)).toBe(true);
    }
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).getAttribute("href")).toBe("/recuperar");
  });

  it("se presenta con el nombre del producto y el eslogan como encabezado", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: ESLOGAN }),
    ).toBeDefined();
    expect(screen.getByText(NOMBRE_PRODUCTO)).toBeDefined();
  });

  it("describe las funciones con la decisión clínica en manos de la profesional", () => {
    render(<LoginPage />);

    expect(screen.getByText(ENTRADA_QUE_HACE)).toBeDefined();
    for (const funcion of PORTADA_FUNCIONES) {
      expect(screen.getByRole("heading", { level: 3, name: funcion.titulo })).toBeDefined();
      for (const parrafo of funcion.parrafos) expect(screen.getByText(parrafo)).toBeDefined();
    }
    expect(screen.getByText(/borrador de nota SOAP: Subjetivo, Objetivo, Análisis y Plan/).textContent).toContain("Vos lo revisás, corregís y aprobás");
    expect(screen.getByText(/Un historial longitudinal/).textContent).toContain("aceptás, editás o descartás");
    expect(screen.getByText(ENTRADA_CONFIDENCIALIDAD)).toBeDefined();
  });

  it("distingue el almacenamiento cifrado de la copia PDF exportada", () => {
    render(<LoginPage />);
    expect(screen.getByText(ENTRADA_CONFIDENCIALIDAD).textContent).toContain("antes de guardarse y enviarse");
    expect(screen.queryByText(/La copia local previa no está cifrada/)).toBeNull();
    expect(screen.getByText(/Podés exportar el Recorrido a PDF/).textContent).toContain("sin cifrar");
    expect(screen.queryByText(/se borra cuando aprobás la nota/)).toBeNull();
  });

  it("el formulario sigue funcionando: los dos campos y el botón tienen nombre accesible", () => {
    render(<LoginPage />);

    // getByLabelText falla si el <label> no está asociado al <input>: es
    // exactamente lo que hay que proteger.
    const email = screen.getByLabelText(ENTRADA_EMAIL) as HTMLInputElement;
    const password = screen.getByLabelText(
      ENTRADA_CONTRASENA,
    ) as HTMLInputElement;

    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("current-password");

    const boton = screen.getByRole("button", { name: ENTRAR });
    expect((boton as HTMLButtonElement).type).toBe("submit");
    expect((boton as HTMLButtonElement).disabled).toBe(false);
  });

  it("explica el alcance de Lupita sin abrir un chat antes de entrar", () => {
    render(<LoginPage />);
    expect(screen.getByText(PORTADA_LUPITA).textContent).toContain("No consulta tus pacientes ni tus montos");
    expect(screen.getByText(PORTADA_LUPITA_CUIDADO).textContent).toContain("recibe lo que escribís");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("envía las credenciales por la misma ruta, espera la respuesta y entra", async () => {
    let responder!: (respuesta: Response) => void;
    const peticion = vi.fn(() => new Promise<Response>((resolve) => { responder = resolve; }));
    vi.stubGlobal("fetch", peticion);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(ENTRADA_EMAIL), { target: { value: "prueba@example.test" } });
    fireEvent.change(screen.getByLabelText(ENTRADA_CONTRASENA), { target: { value: "solo-prueba-local" } });
    fireEvent.submit(screen.getByLabelText(ENTRADA_EMAIL).closest("form")!);
    expect(peticion).toHaveBeenCalledExactlyOnceWith("/api/cuenta/entrar", expect.objectContaining({
      method: "POST", body: JSON.stringify({ email: "prueba@example.test", password: "solo-prueba-local" }),
    }));
    expect((screen.getByRole("button", { name: ENTRANDO }) as HTMLButtonElement).disabled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    responder(Response.json({ data: { ok: true } }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("ante un rechazo conserva lo escrito, informa el error y permite reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "rechazado" }, { status: 401 })));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(ENTRADA_EMAIL), { target: { value: "prueba@example.test" } });
    fireEvent.change(screen.getByLabelText(ENTRADA_CONTRASENA), { target: { value: "solo-prueba-local" } });
    fireEvent.submit(screen.getByLabelText(ENTRADA_EMAIL).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain(ENTRADA_ERROR);
    expect((screen.getByLabelText(ENTRADA_EMAIL) as HTMLInputElement).value).toBe("prueba@example.test");
    expect((screen.getByRole("button", { name: ENTRAR }) as HTMLButtonElement).disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});

it("identifica a Mariana Roldán en el pie", () => {
  render(<LoginPage />);
  expect(screen.getByText("© Mariana Roldán").closest("footer")).not.toBeNull();
});
