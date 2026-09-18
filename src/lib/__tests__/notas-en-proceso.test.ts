import { describe, expect, it } from "vitest";

import {
  SEGUIMIENTO_VACIO,
  aplicarEstado,
  cerrarAviso,
  enProceso,
  hayQueConsultar,
  seguir,
  type NotaSeguida,
} from "@/lib/notas-en-proceso";

const lucia: NotaSeguida = { sesionId: "s1", turnoId: "t1", paciente: "Lucía Fernández" };
const ana: NotaSeguida = { sesionId: "s2", turnoId: "t2", paciente: "Ana Pérez" };

describe("cuándo consultar", () => {
  it("sin nada seguido no se consulta", () => {
    expect(hayQueConsultar(SEGUIMIENTO_VACIO)).toBe(false);
  });

  it("con una sesión seguida se consulta, y deja de consultarse cuando sale", () => {
    const s = seguir(SEGUIMIENTO_VACIO, lucia);
    expect(hayQueConsultar(s)).toBe(true);
    expect(hayQueConsultar(aplicarEstado(s, "s1", "revision"))).toBe(false);
  });

  it("solo subiendo y procesando están en proceso", () => {
    expect(["subiendo", "procesando"].every(enProceso)).toBe(true);
    expect(["grabando", "revision", "aprobada", "fallida", null].some(enProceso)).toBe(false);
  });

  it("seguir dos veces la misma sesión no la duplica ni cambia el objeto", () => {
    const s = seguir(SEGUIMIENTO_VACIO, lucia);
    expect(seguir(s, lucia)).toBe(s);
  });

  it("una sesión ya resuelta no se vuelve a seguir (Hoy con datos viejos)", () => {
    const s = aplicarEstado(seguir(SEGUIMIENTO_VACIO, lucia), "s1", "revision");
    const cerrado = cerrarAviso(s, "s1");
    expect(seguir(cerrado, lucia)).toBe(cerrado);
    expect(hayQueConsultar(seguir(cerrado, lucia))).toBe(false);
  });
});

describe("cuándo avisar", () => {
  const dos = seguir(seguir(SEGUIMIENTO_VACIO, lucia), ana);

  it("mientras sigue en proceso no avisa ni cambia nada", () => {
    expect(aplicarEstado(dos, "s1", "procesando")).toBe(dos);
    expect(aplicarEstado(dos, "s1", "subiendo")).toBe(dos);
  });

  it("revision avisa que la nota está lista, con el nombre, y deja de seguirla", () => {
    const s = aplicarEstado(dos, "s1", "revision");
    expect(s.avisos).toEqual([{ sesionId: "s1", paciente: "Lucía Fernández", tipo: "lista" }]);
    expect(s.seguidas.map((n) => n.sesionId)).toEqual(["s2"]);
  });

  it("fallida avisa el fallo", () => {
    expect(aplicarEstado(dos, "s2", "fallida").avisos).toEqual([
      { sesionId: "s2", paciente: "Ana Pérez", tipo: "fallida" },
    ]);
  });

  it("aprobada, vuelta a grabando o sesión borrada salen sin aviso", () => {
    for (const estado of ["aprobada", "grabando", null] as const) {
      const s = aplicarEstado(dos, "s1", estado);
      expect(s.avisos).toEqual([]);
      expect(s.seguidas.map((n) => n.sesionId)).toEqual(["s2"]);
    }
  });

  it("una respuesta sobre una sesión que no se sigue no cambia nada", () => {
    expect(aplicarEstado(dos, "otra", "revision")).toBe(dos);
  });

  it("el aviso queda hasta cerrarlo", () => {
    const s = aplicarEstado(dos, "s1", "revision");
    const despues = aplicarEstado(s, "s2", "procesando");
    expect(despues.avisos).toHaveLength(1);
    expect(cerrarAviso(despues, "s1").avisos).toEqual([]);
    expect(cerrarAviso(despues, "nada")).toBe(despues);
  });
});
