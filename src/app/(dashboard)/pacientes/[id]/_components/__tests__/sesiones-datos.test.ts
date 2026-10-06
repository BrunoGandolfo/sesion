// Las páginas de la lista de sesiones: cómo se funden y cómo se agrupan.
import { describe, expect, it } from "vitest";

import {
  agruparPorMes,
  chipDeEstado,
  conPaginaSiguiente,
  conPrimeraPagina,
  listaInicial,
  temasDeLaSesion,
  type DocResponse,
  type DocSesion,
  type Fila,
} from "../sesiones-datos";

function doc(id: string, fecha = "2026-09-20T13:00:00.000Z"): DocSesion {
  return {
    sesionClinicaId: id, turnoId: `t-${id}`, fecha, duracionMin: 50, duracionAudioSeg: null,
    modalidad: "presencial", estado: "aprobada", nota: null, datos: null, feedback: null,
    aprobadaEn: null, procesadaEn: null,
  };
}

function pagina(sesiones: DocSesion[], totalPages = 3): DocResponse {
  return { pacienteId: "p1", totalSesiones: 25, sesiones, page: 1, totalPages };
}

describe("conPrimeraPagina", () => {
  it("sin páginas extra reemplaza la lista y vuelve a la página 1", () => {
    const prev = { ...listaInicial("p1"), docs: [doc("vieja")], page: 1 };
    const lista = conPrimeraPagina(prev, pagina([doc("a"), doc("b")]), "p1");
    expect(lista.docs.map((d) => d.sesionClinicaId)).toEqual(["a", "b"]);
    expect(lista).toMatchObject({ page: 1, loading: false, error: null, totalSesiones: 25 });
  });

  it("con páginas cargadas conserva las de abajo sin repetir", () => {
    const prev = { ...listaInicial("p1"), docs: [doc("a"), doc("b"), doc("c")], page: 2 };
    const lista = conPrimeraPagina(prev, pagina([doc("nueva"), doc("a")]), "p1");
    expect(lista.docs.map((d) => d.sesionClinicaId)).toEqual(["nueva", "a", "b", "c"]);
    expect(lista.page).toBe(2);
  });

  it("lo cargado de otra paciente no se conserva", () => {
    const prev = { ...listaInicial("p2"), docs: [doc("ajena")], page: 2 };
    const lista = conPrimeraPagina(prev, pagina([doc("a")]), "p1");
    expect(lista.docs.map((d) => d.sesionClinicaId)).toEqual(["a"]);
    expect(lista.pacienteId).toBe("p1");
  });
});

describe("conPaginaSiguiente", () => {
  it("agrega al final sin repetidos y avanza la página", () => {
    const prev = { ...listaInicial("p1"), docs: [doc("a"), doc("b")], loading: true };
    const lista = conPaginaSiguiente(prev, pagina([doc("b"), doc("c")]), "p1", 2);
    expect(lista.docs.map((d) => d.sesionClinicaId)).toEqual(["a", "b", "c"]);
    expect(lista).toMatchObject({ page: 2, loading: false });
  });

  it("una respuesta de otra paciente no se mezcla", () => {
    const prev = { ...listaInicial("p2"), docs: [doc("x")] };
    expect(conPaginaSiguiente(prev, pagina([doc("c")]), "p1", 2)).toBe(prev);
  });
});

describe("agruparPorMes", () => {
  it("agrupa consecutivas del mismo mes de Montevideo, en el orden recibido", () => {
    const filas: Fila[] = [
      doc("s", "2026-09-20T13:00:00.000Z"),
      doc("s2", "2026-09-01T13:00:00.000Z"),
      // 1/9 a la 01:00 UTC todavía es 31 de agosto en Montevideo.
      doc("a", "2026-09-01T01:00:00.000Z"),
    ].map((d) => ({ tipo: "nota", clave: d.sesionClinicaId, fecha: new Date(d.fecha), doc: d }));
    const grupos = agruparPorMes(filas);
    expect(grupos.map((g) => [g.clave, g.filas.length])).toEqual([["2026-09", 2], ["2026-08", 1]]);
    expect(grupos[0].titulo.charAt(0)).toBe(grupos[0].titulo.charAt(0).toUpperCase());
  });
});

describe("textos de la fila", () => {
  it("el chip sigue al estado y no hay chip para un estado sin nombre", () => {
    expect(chipDeEstado("fallida")?.variant).toBe("terracotta");
    expect(chipDeEstado("aprobada")?.variant).toBe("sage");
    expect(chipDeEstado("cancelada" as never)).toBeNull();
  });

  it("sin temas no inventa texto", () => {
    expect(temasDeLaSesion(null)).toBe("");
  });
});
