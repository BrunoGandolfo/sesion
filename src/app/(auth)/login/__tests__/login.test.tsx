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
// `signIn` de next-auth/react se reemplaza porque el test monta la página, no
// la red: sin esto el módulo intenta hablar con el servidor de sesión.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LoginPage from "@/app/(auth)/login/page";
import {
  ENTRADA_AFIRMACIONES,
  ENTRADA_CONFIDENCIALIDAD,
  ENTRADA_CONTRASENA,
  ENTRADA_EMAIL,
  ENTRADA_QUE_HACE,
  ENTRAR,
  ESLOGAN,
  NOMBRE_PRODUCTO,
} from "@/lib/glosario";

describe("Pantalla de entrada", () => {
  it("se presenta: el nombre del producto es el encabezado y el eslogan está al lado", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: NOMBRE_PRODUCTO }),
    ).toBeDefined();
    expect(screen.getByText(ESLOGAN)).toBeDefined();
  });

  it("dice qué hace: una frase, tres afirmaciones y la confidencialidad", () => {
    render(<LoginPage />);

    expect(screen.getByText(ENTRADA_QUE_HACE)).toBeDefined();
    for (const afirmacion of ENTRADA_AFIRMACIONES) {
      expect(screen.getByText(afirmacion)).toBeDefined();
    }
    expect(screen.getByText(ENTRADA_CONFIDENCIALIDAD)).toBeDefined();
  });

  it("aclara que el cifrado empieza al terminar y no protege la copia local previa", () => {
    render(<LoginPage />);
    expect(screen.getByText("Al terminar, el audio se cifra antes de subirse. La copia local previa no está cifrada.")).toBeDefined();
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

  it("no trae a Lupita: la entrada es institucional (docs/diseno/04-personaje.md)", () => {
    const { container } = render(<LoginPage />);

    expect(container.textContent).not.toContain("Lupita");
  });
});
