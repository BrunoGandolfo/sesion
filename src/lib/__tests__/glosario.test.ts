import { describe, it, expect } from "vitest";

import * as glosario from "@/lib/glosario";
import { pluralizar } from "@/lib/glosario";

describe("glosario — constantes de texto", () => {
  it("los cuatro destinos del menú están nombrados", () => {
    expect(glosario.NAV).toEqual({
      HOY: "Hoy",
      AGENDA: "Agenda",
      PACIENTES: "Pacientes",
      COBROS: "Cobros",
    });
  });

  it("la autorización de grabación se llama por su nombre completo", () => {
    expect(glosario.AUTORIZACION_GRABACION).toBe(
      "Autorización para grabar las sesiones",
    );
  });

  it("los métodos de pago se dicen en un solo lugar", () => {
    // Estaban escritos en cuatro pantallas, dos veces como array y dos como
    // Record. La lista y el Record son ahora la misma cosa.
    expect(glosario.METODO_PAGO_LABEL).toEqual({
      efectivo: "Efectivo",
      transferencia: "Transferencia",
      mercadopago: "MercadoPago",
      debito: "Débito",
      credito: "Crédito",
      otro: "Otro",
    });
    expect(glosario.METODOS_PAGO.map((m) => m.value)).toEqual([
      "efectivo",
      "transferencia",
      "mercadopago",
      "debito",
      "credito",
      "otro",
    ]);
    for (const metodo of glosario.METODOS_PAGO) {
      expect(metodo.label).toBe(glosario.METODO_PAGO_LABEL[metodo.value]);
    }
  });

  it("el estado del turno se dice igual en la fila y en el sheet", () => {
    // La fila de la agenda decía "Pagado"/"Pendiente" y el sheet del turno
    // "Cobrado"/"Sin cobrar" para el mismo turno. Ninguna pantalla vuelve a
    // inventar una palabra: si estos nombres cambian, cambian en los dos.
    expect(glosario.PAGADO).toBe("Pagado");
    expect(glosario.PENDIENTE).toBe("Sin cobrar");
    expect(glosario.CANCELADO).toBe("Cancelado");
  });

  it("el selector de rango del Recorrido nombra sus cuatro opciones", () => {
    expect(glosario.RANGO_LABEL).toEqual({
      "10s": "Últimas 10",
      "3m": "3 meses",
      "6m": "6 meses",
      todo: "Todo",
    });
  });

  it("la tendencia de un tema lleva flecha y palabra, nunca la flecha sola", () => {
    for (const valor of Object.values(glosario.TENDENCIA_LABEL)) {
      expect(valor.replace(/[↑↓=\s]/g, "").length).toBeGreaterThan(0);
    }
  });

  it("ningún texto de interfaz quedó vacío", () => {
    for (const [nombre, valor] of Object.entries(glosario)) {
      if (typeof valor !== "string") continue;
      expect(valor.trim(), `${nombre} está vacía`).not.toBe("");
    }
  });
});

// ─── Rigor clínico ────────────────────────────────────────────────────────
// El glosario simplifica el camino, no el contenido. Estos tests son la
// guarda: si alguien "traduce" SOAP o borra la sigla de un instrumento, acá
// se rompe.

describe("glosario — la nota sigue siendo SOAP", () => {
  const secciones = [
    { constante: glosario.SOAP_S, titulo: "Subjetivo (S)", letra: "S" },
    { constante: glosario.SOAP_O, titulo: "Objetivo (O)", letra: "O" },
    { constante: glosario.SOAP_A, titulo: "Análisis (A)", letra: "A" },
    { constante: glosario.SOAP_P, titulo: "Plan (P)", letra: "P" },
  ];

  it.each(secciones)(
    "$titulo conserva su nombre y su letra, y suma una ayuda",
    ({ constante, titulo, letra }) => {
      expect(constante.titulo).toBe(titulo);
      expect(constante.titulo).toContain(`(${letra})`);
      expect(constante.ayuda.trim().length).toBeGreaterThan(0);
      // La ayuda acompaña, no reemplaza: nunca es el título.
      expect(constante.ayuda).not.toBe(constante.titulo);
    },
  );

  it("las cuatro secciones van en orden S, O, A, P", () => {
    expect(glosario.SOAP_SECCIONES.map((s) => s.titulo)).toEqual([
      "Subjetivo (S)",
      "Objetivo (O)",
      "Análisis (A)",
      "Plan (P)",
    ]);
  });

  it("la nota se sigue llamando nota clínica SOAP", () => {
    expect(glosario.NOTA_CLINICA).toContain("SOAP");
  });
});

describe("glosario — los instrumentos conservan su sigla", () => {
  it.each([
    { clave: "GTFS", instrumento: glosario.GTFS, sigla: "GTFS" },
    { clave: "MITI", instrumento: glosario.MITI, sigla: "MITI 4.2.1" },
    { clave: "CTSR", instrumento: glosario.CTSR, sigla: "CTS-R" },
  ])("$clave se sigue llamando $sigla", ({ instrumento, sigla }) => {
    expect(instrumento.sigla).toBe(sigla);
    expect(instrumento.nombre.trim().length).toBeGreaterThan(0);
    expect(instrumento.ayuda.trim().length).toBeGreaterThan(0);
  });
});

describe("glosario — la casilla de riesgo sigue en pie", () => {
  it("mantiene el texto de la confirmación obligatoria antes de aprobar", () => {
    expect(glosario.REVISE_ESTA_SENAL).toBe("Revisé esta señal");
  });
});

// ─── pluralizar ───────────────────────────────────────────────────────────

describe("pluralizar", () => {
  it("usa el singular con 1", () => {
    expect(pluralizar(1, "sesión", "sesiones")).toBe("1 sesión");
  });

  it("usa el plural con 2 o más", () => {
    expect(pluralizar(2, "sesión", "sesiones")).toBe("2 sesiones");
    expect(pluralizar(25, "sesión", "sesiones")).toBe("25 sesiones");
  });

  it("usa el plural con 0, como en castellano", () => {
    expect(pluralizar(0, "sesión", "sesiones")).toBe("0 sesiones");
  });

  it("sirve para cualquier par de palabras", () => {
    expect(pluralizar(1, "nota para revisar", "notas para revisar")).toBe(
      "1 nota para revisar",
    );
    expect(pluralizar(3, "paciente", "pacientes")).toBe("3 pacientes");
  });

  it("el encabezado de Hoy dice '1 sesión en el día', no '1 sesiones'", () => {
    expect(pluralizar(1, "sesión en el día", "sesiones en el día")).toBe(
      "1 sesión en el día",
    );
    expect(pluralizar(4, "sesión en el día", "sesiones en el día")).toBe(
      "4 sesiones en el día",
    );
  });

  it("la fila de cobros dice '1 paciente te debe' en singular", () => {
    expect(pluralizar(1, "paciente te debe", "pacientes te deben")).toBe(
      "1 paciente te debe",
    );
    expect(pluralizar(16, "paciente te debe", "pacientes te deben")).toBe(
      "16 pacientes te deben",
    );
  });
});
