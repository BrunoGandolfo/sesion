import { describe, it, expect } from "vitest";

import * as glosario from "@/lib/glosario";
import { pluralizar } from "@/lib/glosario";
import { METODOS_PAGO } from "@/lib/constantes-turno";

describe("glosario — constantes de texto", () => {
  // Lo que protege este bloque es la forma, no las palabras: las palabras
  // viven en el glosario y copiarlas acá obligaba a cambiarlas dos veces.

  it("los cuatro destinos del menú están nombrados, cada uno distinto", () => {
    expect(Object.keys(glosario.NAV).sort()).toEqual(["AGENDA", "COBROS", "HOY", "PACIENTES"]);
    expect(new Set(Object.values(glosario.NAV)).size).toBe(4);
  });

  it("los métodos de pago se dicen en un solo lugar", () => {
    // Estaban escritos en cuatro pantallas, dos veces como array y dos como
    // Record. La lista y el Record son ahora la misma cosa.
    expect(Object.keys(glosario.METODO_PAGO_LABEL).sort()).toEqual([...METODOS_PAGO].sort());
    expect(glosario.METODOS_PAGO.map((m) => m.value)).toEqual([...METODOS_PAGO]);
    for (const metodo of glosario.METODOS_PAGO) {
      expect(metodo.label).toBe(glosario.METODO_PAGO_LABEL[metodo.value]);
    }
  });

  it("el estado del pago tiene tres palabras distintas", () => {
    expect(new Set([glosario.PAGADO, glosario.PENDIENTE, glosario.CANCELADO]).size).toBe(3);
  });

  it("el selector de rango del Recorrido nombra sus cuatro opciones", () => {
    expect(Object.keys(glosario.RANGO_LABEL).sort()).toEqual(["10s", "3m", "6m", "todo"]);
    expect(new Set(Object.values(glosario.RANGO_LABEL)).size).toBe(4);
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
    { constante: glosario.SOAP_S, nombre: "Subjetivo", letra: "S" },
    { constante: glosario.SOAP_O, nombre: "Objetivo", letra: "O" },
    { constante: glosario.SOAP_A, nombre: "Análisis", letra: "A" },
    { constante: glosario.SOAP_P, nombre: "Plan", letra: "P" },
  ];

  it.each(secciones)(
    "$nombre conserva su nombre y su letra, y suma una ayuda",
    ({ constante, nombre, letra }) => {
      // La regla clínica del glosario: el nombre y la letra no se traducen.
      expect(constante.titulo).toContain(nombre);
      expect(constante.titulo).toContain(`(${letra})`);
      expect(constante.ayuda.trim().length).toBeGreaterThan(0);
      // La ayuda acompaña, no reemplaza: nunca es el título.
      expect(constante.ayuda).not.toBe(constante.titulo);
    },
  );


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
    // La sigla publicada del instrumento es la regla, no un rótulo.
    expect(instrumento.sigla).toContain(sigla);
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

describe("horaCorta: la hora del consultorio, no la del proceso", () => {
  it("22:58 UTC del 28 de septiembre son las 19:58 en Montevideo, con cualquier TZ", () => {
    const anterior = process.env.TZ;
    for (const zona of ["UTC", "Europe/Madrid", "America/Montevideo"]) {
      process.env.TZ = zona;
      try {
        expect(glosario.horaCorta("2026-09-28T22:58:00Z"), zona).toBe("19:58");
        expect(glosario.horaCorta(Date.parse("2026-09-28T22:58:00Z")), zona).toBe("19:58");
      } finally {
        if (anterior === undefined) delete process.env.TZ;
        else process.env.TZ = anterior;
      }
    }
  });

  it("los avisos de grabación la usan", () => {
    const desde = Date.parse("2026-09-28T22:58:00Z");
    expect(glosario.AVISO_SIN_AUDIO_DESDE(desde)).toContain("desde las 19:58");
    expect(glosario.AVISO_HUECO(desde, desde + 5 * 60_000)).toContain("entre las 19:58 y las 20:03");
  });
});

