// @vitest-environment jsdom
//
// La cabecera de usuario es la única puerta a "Tu consultorio", y hasta esta
// tanda no decía serlo: un avatar, un saludo, un nombre y una fecha, sin
// chevron, sin subrayado y sin fondo. El único indicio era un `hover`, que en
// un teléfono no existe.
//
// Lo que se verifica: que el destino esté en el nombre accesible del enlace
// —lo que oye quien usa lector de pantalla— y también escrito en pantalla,
// que es lo que ve el resto.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { TU_CONSULTORIO } from "@/lib/glosario";

const AHORA = new Date("2026-09-07T15:00:00.000Z");

describe("CabeceraUsuario", () => {
  it("el enlace tiene un nombre accesible que dice a dónde lleva", () => {
    render(<CabeceraUsuario nombre="Mariana Roldán" ahora={AHORA} conSaludo />);

    const enlace = screen.getByRole("link", {
      name: new RegExp(TU_CONSULTORIO, "i"),
    });
    expect(enlace.getAttribute("href")).toBe("/config");
  });

  it("lo dice también en pantalla, con su chevron", () => {
    const { container } = render(
      <CabeceraUsuario nombre="Mariana Roldán" ahora={AHORA} />,
    );

    const rotulo = screen.getByText(TU_CONSULTORIO);
    expect(rotulo).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("las iniciales salen del nombre completo, no del primer nombre", () => {
    // El avatar es el ancla visual del acceso: si cambia de contenido entre
    // pantallas (MA en Hoy, MR en Cobros) deja de ser un ancla.
    const { container } = render(
      <CabeceraUsuario nombre="Mariana Roldán" ahora={AHORA} />,
    );
    expect(container.querySelector("span[aria-hidden]")?.textContent).toBe(
      "MR",
    );
  });

  it("sin nombre todavía, el enlace sigue diciendo su destino", () => {
    render(<CabeceraUsuario nombre={null} ahora={null} />);
    expect(
      screen.getByRole("link", { name: new RegExp(TU_CONSULTORIO, "i") }),
    ).toBeTruthy();
  });
});
