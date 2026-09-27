// @vitest-environment jsdom
//
// El movimiento de la portada (docs/diseno/07-portada.md), por lo que se
// puede afirmar sin un navegador:
//
//  - la marca se traza sólo en la portada: el dibujo que comparte con el
//    ícono sale sin clase ni pathLength;
//  - el nombre, el titular y el párrafo llevan `brota`; el formulario no
//    lleva ninguna animación;
//  - Lupita espera a que su sección entre en la vista, brota una vez y sólo
//    ahí: no en el encabezado ni junto al formulario;
//  - con movimiento reducido aparece de entrada, sin gesto;
//  - la página hidrata sin errores ni contenido oculto por JS.
//
// Que las animaciones CSS se apaguen con la preferencia lo cubre
// limites-movimiento.test.tsx (la regla global de globals.css).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LoginPage from "@/app/(auth)/login/page";
import { Marca, MEDIDAS_BASE } from "@/app/_marca";
import { ENTRADA_EMAIL, ENTRADA_QUE_HACE, ESLOGAN, NOMBRE_PRODUCTO, PORTADA_LUPITA_TITULO } from "@/lib/glosario";

afterEach(() => { vi.unstubAllGlobals(); });

/** IntersectionObserver de mentira: guarda el callback para disparar a mano. */
function observadorManual() {
  type Entrada = { isIntersecting: boolean; intersectionRatio: number };
  const avisos: Array<(entradas: Entrada[]) => void> = [];
  const desconectar = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(aviso: (entradas: Entrada[]) => void) { avisos.push(aviso); }
    observe() {}
    disconnect() { desconectar(); }
  });
  return {
    entra: () => act(() => { for (const aviso of avisos) aviso([{ isIntersecting: true, intersectionRatio: 1 }]); }),
    asoma: () => act(() => { for (const aviso of avisos) aviso([{ isIntersecting: true, intersectionRatio: 0.05 }]); }),
    fuera: () => act(() => { for (const aviso of avisos) aviso([{ isIntersecting: false, intersectionRatio: 0 }]); }),
    desconectar,
  };
}

function preferirQuietud(quieta: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: quieta && query.includes("prefers-reduced-motion"),
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  }));
}

const seccionLupita = () => screen.getByRole("heading", { name: PORTADA_LUPITA_TITULO }).closest("section")!;

describe("la marca", () => {
  it("se traza en la portada y el dibujo compartido con el ícono queda sin animación", () => {
    const { container } = render(<Marca lado={44} medidas={MEDIDAS_BASE} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBeNull();
    expect(container.querySelector("line")!.getAttribute("pathLength")).toBeNull();

    render(<LoginPage />);
    const trazada = document.querySelector("header svg.marca-trazada");
    expect(trazada).not.toBeNull();
    expect(trazada!.querySelector("line")!.getAttribute("pathLength")).toBe("1");
  });

  it("el CSS traza el hilo y hace brotar el nombre con los tiempos comunes", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.marca-trazada line \{[^}]*animation: traza-hilo var\(--duration-pliegue\) var\(--ease-out\) both/);
    expect(css).toMatch(/\.brota \{ animation: brota var\(--duration-pliegue\) var\(--ease-out\) both; \}/);
    expect(css).not.toMatch(/(traza-hilo|aparece-cuenta|brota)[^;{}]*infinite/);
  });
});

describe("el héroe y el formulario", () => {
  it("el nombre, el titular y el párrafo brotan; el párrafo 80 ms después", () => {
    render(<LoginPage />);
    expect(screen.getByText(NOMBRE_PRODUCTO).className).toMatch(/\bbrota\b.*\bbrota-despues-de-la-marca\b/);
    expect(screen.getByRole("heading", { level: 1, name: ESLOGAN }).className).toMatch(/\bbrota\b/);
    const parrafo = screen.getByText(ENTRADA_QUE_HACE);
    expect(parrafo.className).toMatch(/\bbrota\b/);
    expect(parrafo.className).toMatch(/\bbrota-escalon\b/);
  });

  it("el formulario entra quieto: nada adentro ni alrededor lleva animación", () => {
    render(<LoginPage />);
    const ingresar = document.querySelector("#ingresar")!;
    expect(ingresar.querySelector("form")).toBe(screen.getByLabelText(ENTRADA_EMAIL).closest("form"));
    for (let nodo: Element | null = ingresar; nodo; nodo = nodo.parentElement) {
      expect(nodo.className?.toString() ?? "").not.toMatch(/\bbrota|marca-trazada/);
    }
    expect(ingresar.querySelector(".brota, .marca-trazada, [data-movimiento]")).toBeNull();
  });
});

describe("Lupita", () => {
  it("espera a que se vea la mitad de su lugar, brota una vez y no vuelve a observar", () => {
    preferirQuietud(false);
    const io = observadorManual();
    render(<LoginPage />);
    const lugar = seccionLupita().querySelector("[data-lupita-portada]")!;
    expect(lugar.getAttribute("aria-hidden")).toBe("true");
    expect(lugar.querySelector("[data-pose]")).toBeNull();

    io.fuera();
    expect(lugar.querySelector("[data-pose]")).toBeNull();
    io.asoma();
    expect(lugar.querySelector("[data-pose]")).toBeNull();
    expect(io.desconectar).not.toHaveBeenCalled();
    io.entra();
    expect(lugar.getAttribute("data-lupita-portada")).toBe("vista");
    expect(lugar.querySelector("[data-pose]")!.getAttribute("data-pose")).toBe("saluda");
    expect(lugar.querySelector("svg")!.getAttribute("width")).toBe("72");
    expect(io.desconectar).toHaveBeenCalled();
  });

  it("aparece sólo en su sección: ni en el encabezado ni junto al formulario", () => {
    preferirQuietud(false);
    const io = observadorManual();
    render(<LoginPage />);
    io.entra();
    const poses = document.querySelectorAll("[data-pose]");
    for (const pose of poses) expect(seccionLupita().contains(pose)).toBe(true);
    expect(document.querySelector("header [data-pose], #ingresar [data-pose]")).toBeNull();
  });

  // Que Lupita no haga el gesto con la preferencia lo decide ella misma
  // (useMovimientoReducido; framer-motion lee la preferencia una vez por
  // módulo, por eso no se puede cambiar acá entre tests). Lo de la portada es
  // no esperar al scroll: la página aparece completa.
  it("con movimiento reducido está desde el principio, sin esperar a la vista", () => {
    preferirQuietud(true);
    observadorManual();
    render(<LoginPage />);
    const lugar = seccionLupita().querySelector("[data-lupita-portada]")!;
    expect(lugar.getAttribute("data-lupita-portada")).toBe("vista");
    expect(lugar.querySelector("[data-pose]")).not.toBeNull();
  });
});

it("la portada hidrata sin errores y sin ocultar contenido desde JS", async () => {
  preferirQuietud(false);
  observadorManual();
  const nodo = document.createElement("div");
  nodo.innerHTML = renderToString(<LoginPage />);
  document.body.appendChild(nodo);
  const titular = nodo.querySelector("h1");
  const onRecoverableError = vi.fn();
  let raiz!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { raiz = hydrateRoot(nodo, <LoginPage />, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(nodo.querySelector("h1")).toBe(titular);
    // La entrada es CSS: nada escribe opacidad en línea.
    for (const el of nodo.querySelectorAll<HTMLElement>("header *, h1, #ingresar *")) {
      expect(el.style.opacity).toBe("");
    }
  } finally {
    await act(async () => { raiz.unmount(); });
    nodo.remove();
  }
});
