// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvisosDeNotas } from "@/components/layout/avisos-de-notas";
import { AyudaDelPanel } from "@/components/layout/ayuda-del-panel";
import { BottomNav } from "@/components/layout/bottom-nav";
import { IndicadorProcesando } from "@/components/ui/procesando";
import {
  INTERVALO_CONSULTA_MS,
  RUTA_AVISOS,
  olvidarNotas,
  seguirNota,
  type AvisoServidor,
} from "@/lib/notas-en-proceso";

const navegacion = vi.hoisted(() => ({ ruta: "/cobros" }));
vi.mock("next/navigation", () => ({ usePathname: () => navegacion.ruta }));
vi.mock("@/components/ayuda/panel-ayuda", () => ({ PanelAyuda: () => null }));

/** Lo que contesta GET /api/sesion-clinica/avisos en cada momento. */
let servidor: AvisoServidor[];
const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
  new Response(JSON.stringify({ data: servidor }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
);

const lucia = (estado: AvisoServidor["estado"]): AvisoServidor => ({
  id: "s1",
  paciente: "Lucía Fernández",
  estado,
  fecha: "2026-09-23T13:00:00.000Z",
});
const ana = (estado: AvisoServidor["estado"]): AvisoServidor => ({
  id: "s2",
  paciente: "Ana Pérez",
  estado,
  fecha: "2026-09-23T14:00:00.000Z",
});

/** El panel como lo arma el layout: la franja y el menú de abajo. */
function Panel() {
  return (
    <AyudaDelPanel>
      <main>
        <AvisosDeNotas />
      </main>
      <BottomNav />
    </AyudaDelPanel>
  );
}

async function pasar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Monta el panel y deja que conteste la consulta del arranque. */
async function montar() {
  const vista = render(<Panel />);
  await pasar(0);
  return vista;
}

function navegarA(ruta: string, rerender: (ui: React.ReactElement) => void) {
  navegacion.ruta = ruta;
  rerender(<Panel />);
}

const franja = () => screen.queryByRole("region", { name: "Avisos de notas" });
const hoy = () => screen.getByRole("link", { name: /^Hoy/ });
const pedidosDeSondeo = () =>
  fetchMock.mock.calls.filter(([url]) => url === RUTA_AVISOS).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  servidor = [];
  navegacion.ruta = "/cobros";
  act(() => olvidarNotas());
});

afterEach(() => {
  act(() => olvidarNotas());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("la franja de avisos de notas", () => {
  it("en Cobros, una sesión que pasa a revision aparece en menos de 20 s, con el nombre y el globito en Hoy", async () => {
    servidor = [lucia("procesando")];
    await montar();
    expect(franja()).toBeNull();
    expect(hoy().textContent).toBe("Hoy");

    servidor = [lucia("revision")];
    await pasar(19_000);

    const region = franja()!;
    expect(within(region).getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Revisar" }).getAttribute("href")).toBe("/sesiones/s1");
    expect(hoy().textContent).toContain("1");
    expect(hoy().textContent).toContain("1 nota para mirar");
    // No se cierra con una cruz.
    expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
  });

  it("cerrar y volver a abrir la pestaña no la hace desaparecer: la cuenta el servidor", async () => {
    servidor = [lucia("revision")];
    const primera = await montar();
    expect(franja()).not.toBeNull();

    // Se cierra la pestaña: se va todo lo que había en memoria.
    primera.unmount();
    act(() => olvidarNotas());

    await montar();
    expect(within(franja()!).getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
  });

  it("abrir la nota la saca de la franja y del globito, y volver a Cobros no la repone", async () => {
    servidor = [lucia("revision")];
    const { rerender } = await montar();
    expect(franja()).not.toBeNull();

    fireEvent.click(within(franja()!).getByRole("link", { name: "Revisar" }));
    navegarA("/sesiones/s1", rerender);
    expect(franja()).toBeNull();
    expect(hoy().textContent).toBe("Hoy");

    // Al volver a Cobros pregunta en el acto. Si esa respuesta todavía la
    // trae (el sesion.ver no llegó a la base a tiempo), no vuelve.
    const antes = pedidosDeSondeo();
    navegarA("/cobros", rerender);
    await pasar(0);
    expect(pedidosDeSondeo()).toBe(antes + 1);
    expect(franja()).toBeNull();

    // El servidor ya registró el sesion.ver.
    servidor = [];
    await pasar(60_000);
    expect(franja()).toBeNull();
    expect(hoy().textContent).toBe("Hoy");
  });

  it("si la nota no se llegó a leer, el servidor la sigue trayendo y el aviso vuelve", async () => {
    servidor = [lucia("revision")];
    const { rerender } = await montar();
    fireEvent.click(within(franja()!).getByRole("link", { name: "Revisar" }));
    navegarA("/sesiones/s1", rerender);
    navegarA("/cobros", rerender);
    await pasar(0);
    expect(franja()).toBeNull();

    // La pantalla de la nota falló: ningún sesion.ver. La vuelta siguiente,
    // ya fuera del margen, la repone.
    await pasar(60_000);
    expect(within(franja()!).getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
    expect(hoy().textContent).toContain("1 nota para mirar");
  });

  it("si falla la consulta del arranque, sin saber de nada pendiente, reintenta", async () => {
    servidor = [lucia("revision")];
    fetchMock.mockRejectedValueOnce(new TypeError("sin red"));
    await montar();
    expect(franja()).toBeNull();
    await pasar(INTERVALO_CONSULTA_MS);
    expect(within(franja()!).getByText("La nota de Lucía Fernández está lista")).toBeTruthy();
    // Con la respuesta buena vuelve al ritmo de "solo sin ver".
    const despues = pedidosDeSondeo();
    await pasar(INTERVALO_CONSULTA_MS * 3);
    expect(pedidosDeSondeo()).toBe(despues);
  });

  it("con la sesión vencida (401) no insiste", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await montar();
    await pasar(60_000);
    expect(pedidosDeSondeo()).toBe(1);
  });

  it("una sesión fallida muestra la franja de fallo con Ver qué pasó", async () => {
    servidor = [lucia("fallida")];
    await montar();
    const region = franja()!;
    expect(within(region).getByText("No pudimos escribir la nota de Lucía Fernández")).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Ver qué pasó" }).getAttribute("href")).toBe("/sesiones/s1");
  });

  it("con nada en proceso ni sin ver, en 60 s no sale ningún pedido de sondeo", async () => {
    await montar();
    // La del arranque, y ninguna más.
    expect(pedidosDeSondeo()).toBe(1);
    await pasar(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(franja()).toBeNull();
  });

  it("nunca sondea GET /api/sesion-clinica/[id], que deja auditoría", async () => {
    servidor = [lucia("procesando"), ana("revision")];
    await montar();
    await pasar(INTERVALO_CONSULTA_MS * 8);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
    for (const [url] of fetchMock.mock.calls) expect(url).toBe(RUTA_AVISOS);
  });

  it("con dos avisos hay una sola franja con cuántas y de quiénes, que despliega un renglón por sesión", async () => {
    servidor = [lucia("revision"), ana("revision")];
    await montar();
    const region = franja()!;
    expect(within(region).getByText("2 notas listas")).toBeTruthy();
    expect(within(region).getByText("Lucía Fernández y Ana Pérez")).toBeTruthy();
    expect(within(region).queryByRole("link", { name: "Revisar" })).toBeNull();
    expect(hoy().textContent).toContain("2 notas para mirar");

    const ver = within(region).getByRole("button", { name: "Ver" });
    expect(ver.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ver);
    expect(within(region).getByRole("button", { name: "Ocultar" }).getAttribute("aria-expanded")).toBe("true");
    const enlaces = within(region).getAllByRole("link", { name: "Revisar" });
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["/sesiones/s1", "/sesiones/s2"]);
  });

  it("con una lista y una fallida lo dice", async () => {
    servidor = [lucia("revision"), ana("fallida")];
    await montar();
    expect(within(franja()!).getByText("1 nota lista y 1 que no pudimos escribir")).toBeTruthy();
  });

  it("con la pestaña oculta no pregunta; al volver pregunta una vez", async () => {
    servidor = [lucia("procesando")];
    await montar();
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await pasar(INTERVALO_CONSULTA_MS * 4);
    expect(pedidosDeSondeo()).toBe(1);

    servidor = [lucia("revision")];
    vis.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pasar(0);
    expect(pedidosDeSondeo()).toBe(2);
    expect(franja()).not.toBeNull();
    vis.mockRestore();
  });

  it("cuando la ficha u Hoy ven una sesión en proceso nueva, pregunta en el acto", async () => {
    await montar();
    servidor = [lucia("procesando")];
    act(() => seguirNota({ sesionId: "s1", turnoId: "t1", paciente: "Lucía Fernández" }));
    await pasar(0);
    expect(pedidosDeSondeo()).toBe(2);
    // Y sigue preguntando mientras procesa.
    await pasar(INTERVALO_CONSULTA_MS);
    expect(pedidosDeSondeo()).toBe(3);
  });

  it("al salir de grabar pregunta en el acto, aunque vaya directo a Cobros", async () => {
    navegacion.ruta = "/grabar/t1";
    const { rerender } = await montar();
    servidor = [lucia("procesando")];
    navegarA("/cobros", rerender);
    await pasar(0);
    expect(pedidosDeSondeo()).toBe(2);
  });

  it("en la pantalla de grabar no se muestra: la paciente está frente al teléfono", async () => {
    servidor = [ana("revision")];
    navegacion.ruta = "/grabar/t1";
    await montar();
    expect(franja()).toBeNull();
    expect(hoy().textContent).toContain("1 nota para mirar");
  });

  it("un error de red no pierde lo pendiente: se vuelve a preguntar", async () => {
    servidor = [lucia("procesando")];
    await montar();
    fetchMock.mockRejectedValueOnce(new TypeError("sin red"));
    await pasar(INTERVALO_CONSULTA_MS);
    servidor = [lucia("revision")];
    await pasar(INTERVALO_CONSULTA_MS);
    expect(franja()).not.toBeNull();
  });
});

describe("lo que dejó la versión anterior", () => {
  it("el panel borra al montarse el seguimiento viejo con nombres de pacientes", async () => {
    window.sessionStorage.setItem(
      "sesion:notas-en-proceso",
      JSON.stringify({ seguidas: [{ sesionId: "s9", turnoId: "t9", paciente: "Marta Silva" }], avisos: [], resueltas: [] }),
    );
    await montar();
    expect(window.sessionStorage.getItem("sesion:notas-en-proceso")).toBeNull();
  });

  it("cerrar sesión también lo borra", () => {
    window.sessionStorage.setItem("sesion:notas-en-proceso", "{}");
    act(() => olvidarNotas());
    expect(window.sessionStorage.getItem("sesion:notas-en-proceso")).toBeNull();
  });
});

describe("IndicadorProcesando", () => {
  it("dice Procesando con el nombre de la paciente", () => {
    render(<IndicadorProcesando paciente="Lucía Fernández" />);
    expect(screen.getByRole("status").textContent).toContain("Procesando la sesión de Lucía Fernández");
  });
});
