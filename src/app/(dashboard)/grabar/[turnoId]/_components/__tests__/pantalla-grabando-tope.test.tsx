// @vitest-environment jsdom
//
// El aviso del tope de 2 h 30 dice que lo grabado está a salvo sólo si la
// copia en el teléfono no falló (Grabador.copiaFallida). Sin copia, pide no
// cerrar la pantalla: lo grabado existe sólo ahí.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CORTE_LIMITE, CORTE_LIMITE_SIN_COPIA } from "@/lib/glosario";

import { PantallaGrabando } from "../pantalla-grabando";

vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

function montar(copiaFallida: boolean) {
  const nada = () => {};
  render(
    <PantallaGrabando
      estado="pausado" segundos={9000} nivel={0} silencioso={false} microfonoSilenciado={false}
      hueco={null} pantallaApagada={false} avisoLimite={false} limiteAlcanzado copiaFallida={copiaFallida}
      conmutando={false} confirmando={false} onPausar={nada} onReanudar={nada} onTerminar={nada}
      onCerrarAvisoHueco={nada} onCerrarAvisoPantalla={nada} onPedirDescarte={nada}
      onCancelarDescarte={nada} onDescartar={nada}
    />,
  );
}

describe("el aviso del tope de grabación", () => {
  it("con la copia en el teléfono, lo grabado está a salvo", () => {
    montar(false);
    expect(screen.getByText(CORTE_LIMITE)).toBeTruthy();
    expect(screen.queryByText(CORTE_LIMITE_SIN_COPIA)).toBeNull();
  });

  it("sin copia, no lo promete", () => {
    montar(true);
    expect(screen.getByText(CORTE_LIMITE_SIN_COPIA)).toBeTruthy();
    expect(screen.queryByText(CORTE_LIMITE)).toBeNull();
  });
});
