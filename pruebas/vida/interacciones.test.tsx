// @vitest-environment jsdom
// MEDIR_UI=1 npx vitest run pruebas/vida/interacciones.test.tsx
// Tiempo de respuesta del componente en DOM (sin red ni pintura del navegador).
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button, Segmented } from "@/components/ui";
import { HiloEditor } from "@/components/clinico/HiloEditor";
import { hiloVacio } from "@/lib/hilo/contenido";

function Selector() {
  const [value, setValue] = useState("a");
  return <Segmented options={[{ value: "a", label: "Sesiones" }, { value: "b", label: "Recorrido" }]} value={value} onChange={setValue} />;
}
function Editor() {
  const [value, setValue] = useState(hiloVacio());
  return <HiloEditor valor={value} cambiar={setValue} disabled={false} sesiones={[]} />;
}

it.runIf(process.env.MEDIR_UI === "1")("mide respuesta del botón, cambio de pestaña y edición clínica", () => {
  const resultados: Record<string, { p50: number; p95: number }> = {};
  function medir(nombre: string, accion: (i: number) => void) {
    for (let i = 0; i < 30; i++) accion(i);
    const tiempos = Array.from({ length: 200 }, (_, i) => {
      const inicio = performance.now(); accion(i); return performance.now() - inicio;
    }).sort((a, b) => a - b);
    resultados[nombre] = { p50: +tiempos[100].toFixed(3), p95: +tiempos[190].toFixed(3) };
  }
  const accion = vi.fn();
  render(<Button onClick={accion}>Pausar</Button>);
  const boton = screen.getByRole("button", { name: "Pausar" });
  medir("respuesta_boton", () => fireEvent.click(boton));
  expect(accion).toHaveBeenCalledTimes(230);
  cleanup();
  render(<Selector />);
  const tabs = screen.getAllByRole("tab");
  medir("cambiar_pestana", i => fireEvent.click(tabs[i % 2]));
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  cleanup();
  render(<Editor />);
  const campo = screen.getByRole("textbox", { name: "El recorrido hasta hoy" });
  medir("editar_recorrido", i => fireEvent.change(campo, { target: { value: `Corrección ${i}` } }));
  expect((campo as HTMLTextAreaElement).value).toBe("Corrección 199");
  console.log("MEDICION_UI " + JSON.stringify(resultados));
  cleanup();
});
