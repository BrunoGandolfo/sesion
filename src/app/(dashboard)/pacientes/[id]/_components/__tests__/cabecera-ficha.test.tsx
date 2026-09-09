// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// Lo que se protege es la sección 4 de la auditoría: "Grabar" era un botón
// `fixed` que tapaba texto clínico en las tres pestañas de la ficha, incluido
// el botón "Revocar" de la autorización. El camino elegido no lo corre: lo
// saca del aire y lo pone en el flujo del documento, donde no puede taparle
// nada a nadie. Este test es el que impide que vuelva a flotar.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CabeceraFicha } from "../cabecera-ficha";
import { EDITAR_DATOS, GRABAR } from "@/lib/glosario";
import type { PacienteConDeuda } from "@/types/domain";

const PACIENTE: PacienteConDeuda = {
  id: "p1",
  nombre: "Lucía",
  apellido: "Fernández",
  telefono: "099 123 456",
  email: null,
  tarifa: 2200,
  notas: null,
  activo: true,
  creadoEn: new Date("2026-09-05T15:00:00.000Z"),
  actualizadoEn: new Date("2026-09-05T15:00:00.000Z"),
  ultimaSesion: null,
  deudaTotal: 0,
} as PacienteConDeuda;

function montar() {
  return render(
    <CabeceraFicha
      paciente={PACIENTE}
      proximoTurno={null}
      // true: el aviso de autorización no se monta y no sale a pedir nada.
      consentimientoVigente
      config={null}
      reloadKey={0}
      hrefGrabar="/grabar/nuevo?pacienteId=p1"
      onEditar={() => {}}
      onConsentimientoCambio={() => {}}
    />,
  );
}

describe("CabeceraFicha", () => {
  it("ofrece Grabar en la cabecera, con el destino de la sesión", () => {
    montar();

    const grabar = screen.getByRole("link", { name: GRABAR });
    expect(grabar.getAttribute("href")).toBe("/grabar/nuevo?pacienteId=p1");
  });

  it("Grabar no flota: no puede tapar texto clínico", () => {
    const { container } = montar();

    const grabar = screen.getByRole("link", { name: GRABAR });
    expect(grabar.className).not.toContain("fixed");
    // Y en toda la cabecera no hay ningún elemento sacado del flujo: el
    // botón que tapaba "Revocar" no puede volver por otra puerta.
    expect(container.querySelectorAll("[class*='fixed']")).toHaveLength(0);
    expect(container.querySelectorAll("[class*='absolute']")).toHaveLength(0);
  });

  it("distingue los dos Editar de la ficha: acá se editan los datos", () => {
    montar();

    expect(screen.getByRole("button", { name: EDITAR_DATOS })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });
});
