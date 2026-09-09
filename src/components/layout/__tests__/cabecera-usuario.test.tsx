// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccesoConsultorio, CabeceraUsuario } from "@/components/layout/cabecera-usuario";

const AHORA = new Date("2026-09-07T15:00:00.000Z");

describe("CabeceraUsuario", () => {
  it("separa el nombre del acceso a Tu consultorio", () => {
    render(<CabeceraUsuario nombre="Mariana Roldán" ahora={AHORA} conSaludo />);
    expect(screen.getByRole("link", { name: "Tu consultorio" }).getAttribute("href")).toBe("/config");
    expect(screen.getByText("Mariana").closest("a")).toBeNull();
    expect(screen.getByText(/Buenas|Buen día/)).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("conserva las iniciales del nombre completo", () => {
    render(<CabeceraUsuario nombre="Mariana Roldán" ahora={AHORA} />);
    expect(screen.getByText("MR")).toBeTruthy();
  });

  it("mantiene el acceso mientras carga el nombre", () => {
    render(<CabeceraUsuario nombre={null} ahora={null} />);
    expect(screen.getByRole("link", { name: "Tu consultorio" }).getAttribute("href")).toBe("/config");
    expect(screen.queryByText("Mariana")).toBeNull();
  });
});

it("el engranaje activo identifica Tu consultorio sin enlazar a sí mismo", () => {
  render(<AccesoConsultorio activo />);
  expect(screen.getByRole("img", { name: "Tu consultorio" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link")).toBeNull();
});
