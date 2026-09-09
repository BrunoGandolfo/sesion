// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo que
// lo hace correr en un DOM.
//
// Qué se verifica acá, en tres grupos:
//
//   1. Cada esqueleto dice qué pantalla está cargando. Lo único que hablan
//      es una línea sr-only, y tiene que nombrar la pantalla concreta: quien
//      no ve el dibujo necesita saber QUÉ viene, no que "algo" viene.
//   2. Están quietos. No pulsan, no giran, no se desplazan. No hay nada que
//      degradar con prefers-reduced-motion — y el bloque de globals.css que
//      apaga lo que sí pulsa en el resto de la app sigue en su lugar.
//   3. Un esqueleto, dos usos. La pieza que dibuja loading.tsx y la que
//      dibuja la rama "cargando" del cliente son la misma, y los cuatro
//      loading.tsx salen de este módulo.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  EsqueletoCobros,
  EsqueletoCobrosCuerpo,
  EsqueletoHoy,
  EsqueletoListaPacientes,
  EsqueletoNota,
  EsqueletoNotaCuerpo,
  EsqueletoPacientes,
  EsqueletoPantalla,
} from "@/components/esqueletos";
import {
  ABRIENDO_NOTA,
  CARGANDO_COBROS,
  CARGANDO_HOY,
  CARGANDO_PACIENTES,
  CARGANDO_PANTALLA,
} from "@/lib/glosario";

const RAIZ = path.resolve(__dirname, "../../../..");

function leer(relativo: string): string {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

const PANTALLAS = [
  ["Hoy", <EsqueletoHoy key="hoy" />, CARGANDO_HOY],
  ["Pacientes", <EsqueletoPacientes key="pac" />, CARGANDO_PACIENTES],
  ["Cobros", <EsqueletoCobros key="cob" />, CARGANDO_COBROS],
  ["la nota", <EsqueletoNota key="nota" />, ABRIENDO_NOTA],
  ["el resto del dashboard", <EsqueletoPantalla key="gen" />, CARGANDO_PANTALLA],
] as const;

describe("cada esqueleto nombra su pantalla", () => {
  for (const [nombre, elemento, etiqueta] of PANTALLAS) {
    it(`${nombre} se anuncia como "${etiqueta}"`, () => {
      render(elemento);

      const estado = screen.getByRole("status");
      expect(estado.getAttribute("aria-busy")).toBe("true");
      expect(estado.textContent).toBe(etiqueta);
    });
  }

  it("no dibuja ningún texto visible: lo único que hay son huecos", () => {
    const { container } = render(<EsqueletoHoy />);

    // El único nodo de texto del árbol es el sr-only del envoltorio.
    const visible = Array.from(container.querySelectorAll("*"))
      .filter((el) => !el.className.toString().includes("sr-only"))
      .map((el) => (el.childElementCount === 0 ? el.textContent ?? "" : ""))
      .join("")
      .trim();

    expect(visible).toBe("");
  });

  it("los huecos son decoración: ninguno se anuncia", () => {
    const { container } = render(<EsqueletoNota />);
    const huecos = container.querySelectorAll("span.block");

    expect(huecos.length).toBeGreaterThan(0);
    for (const hueco of huecos) {
      expect(hueco.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("los esqueletos están quietos", () => {
  for (const [nombre, elemento] of PANTALLAS) {
    it(`${nombre} no pulsa, no gira y no se desplaza`, () => {
      const { container } = render(elemento);
      const html = container.innerHTML;

      expect(html).not.toContain("animate-pulse");
      expect(html).not.toContain("animate-spin");
      expect(html).not.toContain("transition");
      // framer-motion escribe sus transformaciones en el style del nodo.
      for (const el of container.querySelectorAll<HTMLElement>("*")) {
        expect(el.style.transform ?? "").toBe("");
        expect(el.style.opacity ?? "").toBe("");
      }
    });
  }

  it("y el bloque de globals.css que apaga lo que sí pulsa sigue ahí", () => {
    // Los esqueletos viejos de la app (ContextoGoldenThreadView,
    // HotWordsManager, ConsentimientoBadge) usan animate-pulse y dependen de
    // esta regla. Los nuevos no la necesitan, pero si alguien la borra
    // pensando que ya no hace falta, esto avisa.
    const css = leer("src/app/globals.css");
    const bloque = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(bloque).toContain(".animate-pulse");
    expect(bloque).toContain(".animate-spin");
    expect(bloque).toContain("animation: none");
  });
});

describe("un esqueleto, dos usos", () => {
  it("la pantalla de Pacientes contiene exactamente la lista del cliente", () => {
    const soloLista = render(<EsqueletoListaPacientes />).container.innerHTML;
    const pantalla = render(<EsqueletoPacientes />).container.innerHTML;

    expect(pantalla).toContain(soloLista);
  });

  it("la pantalla de Cobros contiene exactamente el cuerpo del cliente", () => {
    const soloCuerpo = render(<EsqueletoCobrosCuerpo />).container.innerHTML;
    const pantalla = render(<EsqueletoCobros />).container.innerHTML;

    expect(pantalla).toContain(soloCuerpo);
  });

  it("la pantalla de la nota contiene exactamente el cuerpo del cliente", () => {
    const soloCuerpo = render(<EsqueletoNotaCuerpo />).container.innerHTML;
    const pantalla = render(<EsqueletoNota />).container.innerHTML;

    expect(pantalla).toContain(soloCuerpo);
  });

  const CONSUMIDORES = [
    "src/app/(dashboard)/loading.tsx",
    "src/app/(dashboard)/pacientes/loading.tsx",
    "src/app/(dashboard)/cobros/loading.tsx",
    "src/app/(dashboard)/sesiones/[id]/loading.tsx",
    "src/app/(dashboard)/_components/dashboard.tsx",
    "src/app/(dashboard)/pacientes/_components/pacientes-view.tsx",
    "src/app/(dashboard)/cobros/_components/cobros-view.tsx",
    "src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx",
  ];

  it("las dos esperas de cada pantalla salen del mismo módulo", () => {
    for (const archivo of CONSUMIDORES) {
      expect(leer(archivo)).toContain('from "@/components/esqueletos"');
    }
  });

  it("ninguna de esas pantallas volvió a dibujar 'Cargando…' a mano", () => {
    // Es lo que había antes de los esqueletos y lo que el fundido de página
    // terminaba fundiendo. El sheet de "nuevo paciente" queda afuera: es un
    // formulario dentro de un panel, no una pantalla.
    const pantallas = CONSUMIDORES.filter(
      (a) => !a.endsWith("pacientes-view.tsx"),
    );
    for (const archivo of pantallas) {
      expect(leer(archivo)).not.toMatch(/Cargando…|cargando tu día/);
    }
  });
});
