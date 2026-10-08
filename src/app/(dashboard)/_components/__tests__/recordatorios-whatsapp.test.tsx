// @vitest-environment jsdom
// Recordatorios para hoy: el bloque sólo existe con WhatsApp o Ambos; el
// botón es un enlace que abre WhatsApp sin esperar a nada y, al tocarlo,
// registra el aviso; sin teléfono no hay botón.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordatoriosWhatsapp } from "../recordatorios-whatsapp";
import type { RecordatoriosHoy } from "../recordatorios-datos";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

const ENLACE = "https://wa.me/59899111222?text=Hola";

const ana = {
  turnoId: "t1",
  fecha: "2026-10-09T13:00:00.000Z",
  paciente: { id: "p1", nombre: "Ana", apellido: "Pérez", telefono: "099111222" },
  enlace: ENLACE,
  avisadoEn: null,
};
const beto = {
  turnoId: "t2",
  fecha: "2026-10-09T15:00:00.000Z",
  paciente: { id: "p2", nombre: "Beto", apellido: "Suárez", telefono: null },
  enlace: null,
  motivo: "sin_telefono" as const,
  avisadoEn: null,
};

function responder(lectura: RecordatoriosHoy) {
  api.get.mockResolvedValue(lectura);
}

async function abrir() {
  await act(async () => {
    render(<RecordatoriosWhatsapp />);
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(cleanup);

describe("el bloque según el canal", () => {
  it("con SMS automático no aparece", async () => {
    responder({ canal: "sms", turnos: [ana] });
    await abrir();
    expect(api.get).toHaveBeenCalledWith("/api/recordatorios/whatsapp", expect.anything());
    expect(screen.queryByText("Recordatorios para hoy")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each(["whatsapp", "ambos"] as const)("con %s aparece con sus turnos", async (canal) => {
    responder({ canal, turnos: [ana] });
    await abrir();
    const bloque = screen.getByRole("region", { name: "Recordatorios para hoy" });
    expect(within(bloque).getByText("Ana Pérez")).toBeTruthy();
    // Día y hora del turno, en Montevideo, y el estado.
    expect(within(bloque).getByText(/9 oct · 10:00/)).toBeTruthy();
    expect(within(bloque).getByText("Sin avisar")).toBeTruthy();
  });

  it("sin turnos dice una sola línea", async () => {
    responder({ canal: "whatsapp", turnos: [] });
    await abrir();
    const bloque = screen.getByRole("region", { name: "Recordatorios para hoy" });
    expect(within(bloque).getByText("No hay turnos para avisar hoy")).toBeTruthy();
    expect(within(bloque).queryByRole("list")).toBeNull();
  });
});

describe("Abrir WhatsApp", () => {
  it("es un enlace al mensaje que manda la API y, al tocarlo, registra el aviso", async () => {
    responder({ canal: "whatsapp", turnos: [ana] });
    let resolver!: (v: { avisadoEn: string }) => void;
    api.post.mockReturnValue(new Promise((r) => (resolver = r)));
    await abrir();

    const boton = screen.getByRole("link", { name: "Abrir WhatsApp" });
    // El enlace abre WhatsApp por sí mismo: no depende de ningún pedido.
    expect(boton.getAttribute("href")).toBe(ENLACE);
    expect(boton.getAttribute("target")).toBe("_blank");
    expect(boton.getAttribute("rel")).toBe("noopener");

    // jsdom no navega; lo que importa es que el click no se cancela.
    let cancelado = true;
    const mirar = (e: Event) => {
      cancelado = e.defaultPrevented;
      e.preventDefault();
    };
    window.addEventListener("click", mirar);
    fireEvent.click(boton);
    window.removeEventListener("click", mirar);
    expect(cancelado).toBe(false);

    expect(api.post).toHaveBeenCalledWith(
      "/api/recordatorios/whatsapp/t1/abierto",
      {},
      { keepalive: true },
    );
    // Hasta que vuelve el registro, la fila no promete nada.
    expect(screen.getByText("Sin avisar")).toBeTruthy();
    await act(async () => resolver({ avisadoEn: "2026-10-08T13:32:00.000Z" }));
    expect(screen.getByText("Avisado 10:32")).toBeTruthy();
    expect(screen.queryByText("Sin avisar")).toBeNull();
  });

  it("si el registro falla, el enlace ya abrió y la fila lo dice", async () => {
    responder({ canal: "whatsapp", turnos: [ana] });
    api.post.mockRejectedValue(new Error("Failed to fetch"));
    await abrir();
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Abrir WhatsApp" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Se abrió WhatsApp, pero no quedó anotado.");
    expect(screen.getByText("Sin avisar")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir WhatsApp" })).toBeTruthy();
  });

  it("muestra la hora del aviso que ya estaba hecho", async () => {
    responder({ canal: "ambos", turnos: [{ ...ana, avisadoEn: "2026-10-08T12:05:00.000Z" }] });
    await abrir();
    expect(screen.getByText("Avisado 09:05")).toBeTruthy();
  });
});

describe("sin teléfono", () => {
  it("no hay botón: la fila se apaga y lleva a la ficha", async () => {
    responder({ canal: "whatsapp", turnos: [ana, beto] });
    await abrir();
    const filas = screen.getAllByRole("listitem");
    expect(filas).toHaveLength(2);
    const fila = filas[1];
    expect(within(fila).getByText("Beto Suárez").className).toContain("text-ink-500");
    expect(within(fila).getByText("Sin teléfono")).toBeTruthy();
    expect(within(fila).queryByRole("link", { name: "Abrir WhatsApp" })).toBeNull();
    expect(within(fila).getByRole("link", { name: /Ver ficha/ }).getAttribute("href")).toBe("/pacientes/p2");
    expect(screen.getAllByRole("link", { name: "Abrir WhatsApp" })).toHaveLength(1);
  });
});

describe("si la lectura falla", () => {
  it("una recarga que falla deja lo que había y lo dice", async () => {
    responder({ canal: "whatsapp", turnos: [ana] });
    let vista!: ReturnType<typeof render>;
    await act(async () => {
      vista = render(<RecordatoriosWhatsapp reloadKey={0} />);
    });
    api.get.mockRejectedValueOnce(new Error("Failed to fetch"));
    await act(async () => {
      vista.rerender(<RecordatoriosWhatsapp reloadKey={1} />);
    });
    expect(screen.getByRole("alert").textContent).toBe("No se pudieron leer los recordatorios de hoy.");
    expect(screen.getByText("Ana Pérez")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });


  it("lo dice y deja reintentar", async () => {
    api.get.mockRejectedValueOnce(new Error("Failed to fetch"));
    api.get.mockResolvedValueOnce({ canal: "whatsapp", turnos: [ana] });
    await abrir();
    expect(screen.getByRole("alert").textContent).toBe("No se pudieron leer los recordatorios de hoy.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });
    expect(screen.getByText("Ana Pérez")).toBeTruthy();
  });
});
