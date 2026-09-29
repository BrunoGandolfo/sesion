// @vitest-environment jsdom
//
// Qué lee ella cuando agregar un término falla: el motivo del servidor si lo
// dio, "ya existe" en un 409, y un texto propio ante un corte de red. Antes
// los cinco pedidos eran fetch a mano y cualquier 400 caía en el genérico.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { HotWordsManager } from "@/components/grabacion/HotWordsManager";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function agregarCon(respuestaDelPost: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? respuestaDelPost() : json({ data: [] }),
    ),
  );
  render(<HotWordsManager compacto scope="profesional" />);
  fireEvent.change(await screen.findByLabelText("Nuevo término"), {
    target: { value: "transferencia" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
}

describe("HotWordsManager · errores al agregar", () => {
  it("un 409 dice que el término ya existe", async () => {
    await agregarCon(async () => json({ error: "Duplicado" }, 409));
    expect(await screen.findByText("Este término ya existe")).toBeTruthy();
  });

  it("muestra el motivo que dio el servidor", async () => {
    await agregarCon(async () => json({ error: "El término no puede tener más de cinco palabras." }, 400));
    expect(await screen.findByText("El término no puede tener más de cinco palabras.")).toBeTruthy();
  });

  it("ante un corte de red no muestra el error técnico", async () => {
    await agregarCon(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await screen.findByText("No pudimos agregar el término. Intentá de nuevo.")).toBeTruthy();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });
});
