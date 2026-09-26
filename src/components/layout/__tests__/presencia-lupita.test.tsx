// @vitest-environment jsdom
//
// La posada: Lupita como presencia (docs/diseno/06-lupita-presencia.md, D0).
// El dibujo y su movimiento se prueban en ui/__tests__/lupita.test.tsx; acá,
// dónde está, cuándo se va, qué hace al tocarla y qué gestos le llegan.

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { AyudaDelPanel } from "@/components/layout/ayuda-del-panel";
import { ID_HUECO_LATERAL, PresenciaLupita } from "@/components/layout/presencia-lupita";
import type { LupitaProps } from "@/components/ui/lupita";
import {
  ALTO_MENU_MOVIL,
  anotarLupitaViva,
  avisarLupita,
  obtenerParpadeo,
  anotarRiesgoDelDiaLupita,
  reiniciarLupitaParaTests,
} from "@/lib/lupita-presencia";
import { TIEMPOS, TIEMPOS_LUPITA } from "@/lib/movimiento";

const entorno = vi.hoisted(() => ({ ruta: "/", reducido: false, escritorio: false }));

vi.mock("next/navigation", () => ({ usePathname: () => entorno.ruta }));
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  return {
    ...original,
    useReducedMotion: () => entorno.reducido,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      ...original.motion,
      button: (props: React.ComponentProps<"button"> & Record<string, unknown>) => {
        const limpio = { ...props };
        for (const clave of ["initial", "animate", "exit", "transition"]) delete limpio[clave];
        return <button {...(limpio as React.ComponentProps<"button">)} />;
      },
    },
  };
});
vi.mock("@/components/ui/lupita", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/ui/lupita")>(),
  Lupita: ({ movimiento = "quieta", tamano, enPosada }: LupitaProps) => (
    <span data-testid={enPosada ? "posada" : "otra"} data-movimiento={movimiento} data-tamano={tamano} />
  ),
}));
vi.mock("@/components/ayuda/panel-ayuda", () => ({
  PanelAyuda: ({ abierto }: { abierto: boolean }) => (abierto ? <div role="dialog" aria-label="Lupita" /> : null),
}));

beforeEach(() => {
  vi.useFakeTimers();
  reiniciarLupitaParaTests();
  // Como si Hoy ya hubiera leído un día sin riesgo; el caso contrario tiene
  // su propia prueba.
  anotarRiesgoDelDiaLupita(false);
  entorno.ruta = "/";
  entorno.reducido = false;
  entorno.escritorio = false;
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta === "(min-width: 64rem)" && entorno.escritorio,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

function montar(extra?: React.ReactNode) {
  return render(
    <AyudaDelPanel>
      {extra}
      <PresenciaLupita />
    </AyudaDelPanel>,
  );
}

function posada() {
  return document.querySelector<HTMLButtonElement>("[data-lupita-posada]");
}
function movimiento() {
  return screen.getByTestId("posada").getAttribute("data-movimiento");
}

describe("dónde está", () => {
  it.each(["/", "/agenda", "/pacientes", "/cobros", "/config"])("en %s está posada sobre el menú y respira", (ruta) => {
    entorno.ruta = ruta;
    montar();
    const boton = posada()!;
    expect(boton).not.toBeNull();
    expect(boton.getAttribute("data-lupita-posada")).toBe("menu");
    expect(boton.style.bottom).toBe(`${ALTO_MENU_MOVIL}px`);
    expect(movimiento()).toBe("respira");
    expect(screen.getByTestId("posada").getAttribute("data-tamano")).toBe("34");
  });

  it.each(["/grabar/t1", "/pacientes/p1", "/sesiones/s1", "/sesiones/s1/transcripcion", "/deudores", "/finanzas"])(
    "en %s no está (06, D0 y D3)",
    (ruta) => {
      entorno.ruta = ruta;
      montar();
      expect(posada()).toBeNull();
    },
  );

  it("es un atajo de puntero: fuera del lector de pantalla y del tabulador", () => {
    montar();
    expect(posada()!.getAttribute("aria-hidden")).toBe("true");
    expect(posada()!.tabIndex).toBe(-1);
  });

  it("en la computadora se posa en el hueco del lateral", () => {
    entorno.escritorio = true;
    render(
      <AyudaDelPanel>
        <div id={ID_HUECO_LATERAL} data-testid="hueco" />
        <PresenciaLupita />
      </AyudaDelPanel>,
    );
    const boton = posada()!;
    expect(boton.getAttribute("data-lupita-posada")).toBe("lateral");
    expect(screen.getByTestId("hueco").contains(boton)).toBe(true);
  });
});

describe("cuándo se va", () => {
  it("se retira con un sheet abierto y vuelve al cerrarlo", async () => {
    montar();
    await act(async () => { document.body.style.overflow = "hidden"; });
    expect(posada()).toBeNull();
    await act(async () => { document.body.style.overflow = ""; });
    expect(posada()).not.toBeNull();
  });

  it("se retira con el teclado del teléfono abierto", () => {
    montar(<input aria-label="Buscar" />);
    fireEvent.focusIn(screen.getByLabelText("Buscar"));
    expect(posada()).toBeNull();
    fireEvent.focusOut(screen.getByLabelText("Buscar"));
    expect(posada()).not.toBeNull();
  });

  it("en Hoy aparece sólo cuando Hoy confirma que no hay riesgo en el día", () => {
    montar();
    act(() => anotarRiesgoDelDiaLupita(null));
    expect(posada()).toBeNull();
    act(() => anotarRiesgoDelDiaLupita(true));
    expect(posada()).toBeNull();
    act(() => anotarRiesgoDelDiaLupita(false));
    expect(posada()).not.toBeNull();
  });

  it("con otra Lupita viva en la pantalla se queda quieta (una sola viva)", () => {
    montar();
    act(() => anotarLupitaViva(1));
    expect(movimiento()).toBe("quieta");
    act(() => anotarLupitaViva(-1));
    expect(movimiento()).toBe("respira");
  });
});

describe("gestos", () => {
  it("al tocarla saluda y abre el chat cuando termina el saludo", async () => {
    montar();
    // Pasado el brota de entrada.
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(posada()!);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(movimiento()).toBe("saludo");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(TIEMPOS_LUPITA.gesto));
    expect(screen.getByRole("dialog", { name: "Lupita" })).toBeTruthy();
  });

  it("la aprobación guardada: brota y después asiente al volver", async () => {
    entorno.ruta = "/sesiones/s1";
    const { rerender } = montar();
    act(() => { avisarLupita("aprobada"); });
    expect(posada()).toBeNull();
    entorno.ruta = "/";
    rerender(<AyudaDelPanel><PresenciaLupita /></AyudaDelPanel>);
    expect(posada()).not.toBeNull();
    // Primero termina de brotar…
    expect(movimiento()).toBe("respira");
    await act(() => vi.advanceTimersByTimeAsync(TIEMPOS.pliegue - 20));
    expect(movimiento()).toBe("respira");
    // …después asiente, y vuelve al reposo.
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(movimiento()).toBe("asiente");
    await act(() => vi.advanceTimersByTimeAsync(TIEMPOS_LUPITA.gesto));
    expect(movimiento()).toBe("respira");
  });

  it("con movimiento reducido no hay gesto y el chat se abre enseguida", async () => {
    entorno.reducido = true;
    montar();
    fireEvent.click(posada()!);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(movimiento()).not.toBe("saludo");
    expect(screen.getByRole("dialog", { name: "Lupita" })).toBeTruthy();
  });
});

describe("el reloj del parpadeo", () => {
  it("late cada 4 a 9 s mientras la posada vive", async () => {
    montar();
    const antes = obtenerParpadeo();
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(obtenerParpadeo()).toBeGreaterThan(antes);
  });

  it("no late con movimiento reducido ni sin ninguna Lupita viva", async () => {
    entorno.reducido = true;
    const { unmount } = montar();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(obtenerParpadeo()).toBe(0);
    unmount();
    entorno.reducido = false;
    entorno.ruta = "/deudores";
    montar();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(obtenerParpadeo()).toBe(0);
  });
});
