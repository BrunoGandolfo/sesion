// @vitest-environment jsdom
//
// La hoja impresa del Recorrido no cambia cuando cambia la pantalla.
//
// HiloContenido y los gráficos se comparten entre la pestaña Recorrido y esta
// hoja. La referencia (__snapshots__/hoja-sin-senal.html) se generó con el
// código de origin/main ee83f7b, ANTES de reordenar la pantalla: si un cambio
// de presentación se cuela en el papel, este test lo dice. La única
// diferencia de contenido admitida es la alerta de la última sesión cuando
// el servidor marca una señal (segundo caso; desde el 08/10/2026, cualquier
// sesión con señal). El 21/09/2026 se regeneró con
// esta misma fixture por el cambio intencional de paleta A: cinco valores
// de color, sin cambios de texto, estructura, tamaño ni orden.
// El 06/10/2026 (ola 3) se regeneró porque los gráficos pasaron sus colores
// de hex a la variable del token con el MISMO valor (#4F7A6A → var(--color-
// sage-500), etc.): el papel imprime los mismos colores.
// El 08/10/2026 (recorrido-pdf-editorial) se regeneró por el rediseño
// editorial de la hoja: papel crema, cabecera de documento con una línea de
// datos en vez de la lista, el bloque "De un vistazo" (sesiones con nota,
// objetivos activos, el tema que más vuelve, la última señal) y la frase del
// historial mudada a su sección. Se comparó el texto de las dos versiones:
// no falta ningún dato y los SVG de los gráficos son idénticos.
// El mismo día, segunda vuelta: el papel lleva el progreso percibido y la
// observación de TODAS las sesiones (la pantalla, sólo la última), los temas
// con su última vez, y el fixture (fixture-exportacion.ts) es coherente: la
// señal del 20 de agosto está también en el progreso. Con eso la alerta deja
// de ser exclusiva de la última sesión: sale en cada sesión con señal.
// El 08/10/2026 (pdf-flujo) se regeneró porque las secciones dejaron de
// forzar página nueva: sólo cambió el marcado de los saltos (sin
// print:break-before-page; los temas, partibles entre filas). Ningún texto.

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { apiPost } from "@/lib/api-client";
import { ULTIMA_SESION_CON_SENAL } from "@/lib/glosario";

import { RecorridoImprimible } from "../recorrido-imprimible";
import { exportacionDePrueba } from "./fixture-exportacion";

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function hoja(ultimaConSenal: boolean): Promise<string> {
  vi.mocked(apiPost).mockResolvedValue(exportacionDePrueba(ultimaConSenal));
  const { container } = render(<RecorridoImprimible pacienteId="p" />);
  await screen.findByRole("heading", { level: 1, name: "Ana Pérez" });
  return container.querySelector("article")!.outerHTML;
}

it("sin señal en la última sesión, la hoja es idéntica a la de antes del cambio de pantalla", async () => {
  await expect(await hoja(false)).toMatchFileSnapshot("./__snapshots__/hoja-sin-senal.html");
});

it("cada sesión con señal lleva la alerta en su progreso percibido, también la última", async () => {
  const veces = (html: string) => html.split(ULTIMA_SESION_CON_SENAL).length - 1;
  // La sesión del 20 de agosto trae señal en el fixture; la última, no.
  expect(veces(await hoja(false))).toBe(1);
  cleanup();
  const conSenal = await hoja(true);
  expect(veces(conSenal)).toBe(2);
  // «Sin riesgo» en el texto no es lo que la enciende: es el nivel que marcó el servidor.
  expect(conSenal).toContain("Sin riesgo a la vista");
});
