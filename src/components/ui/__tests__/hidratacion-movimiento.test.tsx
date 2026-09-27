// @vitest-environment jsdom
import * as React from "react";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LupitaMenu } from "../lupita";
import { AlturaAnimada } from "../movimiento";
import Template from "@/app/(dashboard)/template";

const preferencia = vi.hoisted(() => ({ reducida: false }));
vi.mock("framer-motion", async original => ({
  ...await original<typeof import("framer-motion")>(),
  useReducedMotion: () => preferencia.reducida,
}));

it.each([false, true])("hidrata sin remontar ni ocultar contenido, reducida=%s", async reducida => {
  preferencia.reducida = reducida;
  const montar = vi.fn();
  const desmontar = vi.fn();
  function Pantalla() {
    React.useEffect(() => { montar(); return desmontar; }, []);
    return <p>Agenda de hoy</p>;
  }
  const contenido = <><Template><AlturaAnimada abierto><Pantalla /></AlturaAnimada></Template><LupitaMenu toque={0} /></>;
  const nodo = document.createElement("div");
  nodo.innerHTML = renderToString(contenido);
  document.body.appendChild(nodo);
  const original = nodo.querySelector("p");
  expect(original?.textContent).toBe("Agenda de hoy");
  const onRecoverableError = vi.fn();
  let raiz!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { raiz = hydrateRoot(nodo, contenido, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(nodo.querySelector("p")).toBe(original);
    expect(montar).toHaveBeenCalledTimes(1);
    expect(desmontar).not.toHaveBeenCalled();
    expect((nodo.firstElementChild as HTMLElement).style.opacity).not.toBe("0");
  } finally {
    await act(async () => { raiz.unmount(); });
    nodo.remove();
  }
});
