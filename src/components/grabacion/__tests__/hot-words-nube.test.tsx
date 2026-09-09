// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// El vocabulario se listaba una fila por término, con categoría y botón:
// con veinte modismos era interminable. Acá se verifica la nube: N chips,
// cada uno con su x, y el contador arriba.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HotWordsManager } from "@/components/grabacion/HotWordsManager";
import { VOCABULARIO_QUITAR } from "@/lib/glosario";

const TERMINOS = [
  { termino: "transferencia", categoria: "termino_clinico" },
  { termino: "gurí", categoria: "modismo_rioplatense" },
  { termino: "Lacan", categoria: "nombre_propio" },
  { termino: "bo", categoria: "modismo_rioplatense" },
  { termino: "trastorno límite de la personalidad", categoria: "otro" },
];

function respuesta(activos = TERMINOS.length) {
  return {
    ok: true,
    json: async () => ({
      data: TERMINOS.map((t, i) => ({
        id: `id-${i}`,
        termino: t.termino,
        categoria: t.categoria,
        activo: i < activos,
        scope: "paciente" as const,
      })),
    }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function montarNube(activos?: number) {
  vi.stubGlobal("fetch", vi.fn(async () => respuesta(activos)));
  render(<HotWordsManager compacto scope="paciente" pacienteId="p1" />);
  await waitFor(() => screen.getByText(TERMINOS[0].termino));
}

describe("HotWordsManager · la nube de vocabulario", () => {
  it("dibuja un chip por término, cada uno con su x", async () => {
    await montarNube();

    for (const { termino } of TERMINOS) {
      expect(screen.getByText(termino)).toBeDefined();
      expect(
        screen.getByRole("button", { name: `${VOCABULARIO_QUITAR} ${termino}` }),
      ).toBeDefined();
    }

    // Una lista de chips, no una fila por término.
    expect(screen.getAllByRole("listitem")).toHaveLength(TERMINOS.length);
  });

  it("cuenta los términos, y los apagados aparte", async () => {
    await montarNube(3);

    expect(screen.getByText(/3 términos activos/)).toBeDefined();
    expect(screen.getByText(/2 inactivos/)).toBeDefined();
  });

  it("el término mismo enciende y apaga, sin borrar", async () => {
    await montarNube();

    const chip = screen.getByRole("button", { name: "transferencia, Término clínico" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
    // Sigue estando: apagar no es quitar.
    expect(screen.getByText("transferencia")).toBeDefined();
  });

  it("quitar pide confirmación antes de borrar", async () => {
    await montarNube();

    fireEvent.click(
      screen.getByRole("button", { name: `${VOCABULARIO_QUITAR} gurí` }),
    );

    const confirmar = await screen.findByRole("button", {
      name: `${VOCABULARIO_QUITAR} gurí, confirmar`,
    });
    expect(confirmar).toBeDefined();
    // Todavía no se fue nadie.
    expect(screen.getByText("gurí")).toBeDefined();
  });
});
