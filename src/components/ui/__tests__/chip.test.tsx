// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// Lo que se protege acá es el bug clínico de la sección 0 de la auditoría:
// un tema del hilo de 423 px en un chip con `whitespace-nowrap` recortaba
// texto clínico contra el borde de la pantalla, en el brief que ella lee un
// minuto antes de que entre la paciente.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Chip } from "@/components/ui/chip";

const TEMA_LARGO = "devolución diagnóstica e inestabilidad emocional · 1";

describe("Chip", () => {
  it("renderiza entero un tema largo, sin recortarlo", () => {
    render(
      <Chip variant="neutral" size="sm" texto="libre">
        {TEMA_LARGO}
      </Chip>,
    );

    // El texto completo está en pantalla: ni truncado ni partido en dos
    // nodos que sólo se ven juntos por CSS.
    const chip = screen.getByText(TEMA_LARGO);
    expect(chip.textContent).toBe(TEMA_LARGO);
    // Está en pantalla, no escondido: el repo no tiene los matchers de
    // jest-dom, así que la visibilidad se mira a mano.
    expect(chip.isConnected).toBe(true);
    expect(chip.hidden).toBe(false);
  });

  it("deja envolver el texto libre: nada de nowrap ni de recorte", () => {
    render(<Chip texto="libre">{TEMA_LARGO}</Chip>);

    const clases = screen.getByText(TEMA_LARGO).className;
    expect(clases).not.toContain("whitespace-nowrap");
    expect(clases).not.toContain("truncate");
    expect(clases).toContain("break-words");
    // El texto libre tampoco va en versalitas: el mismo tema se ve igual en
    // el brief y en el Recorrido.
    expect(clases).not.toContain("uppercase");
  });

  it("no toca los chips de estado: siguen en una línea y en versalitas", () => {
    render(<Chip variant="sage">Pagado</Chip>);

    const clases = screen.getByText("Pagado").className;
    expect(clases).toContain("whitespace-nowrap");
    expect(clases).toContain("uppercase");
  });
});
