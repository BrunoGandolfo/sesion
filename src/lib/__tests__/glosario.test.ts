import { describe, it, expect } from "vitest";

import * as glosario from "@/lib/glosario";
import { pluralizar } from "@/lib/glosario";

// Nombres que la interfaz tiene que poder decir. Si alguno desaparece del
// glosario, alguna pantalla se quedó sin su palabra.
const CONSTANTES_REQUERIDAS = [
  "TU_CONSULTORIO",
  "TE_DEBEN",
  "PARA_REVISAR",
  "NOTA_GUARDADA",
  "ESCRIBIENDO_NOTA",
  "MAS_DE_ESTA_SESION",
  "PARA_VOS",
  "SENAL_DE_RIESGO",
  "LO_QUE_DIJO",
  "APARECIO_POR_PRIMERA_VEZ",
  "VUELVE_A_APARECER",
  "SE_LLEVO",
  "PARA_LA_PROXIMA",
  "EL_HILO",
  "EL_RECORRIDO_HASTA_HOY",
  "SENALES_ANTERIORES",
  "COMO_VA",
  "SESIONES",
  "FICHA",
  "RECORRIDO",
  "AGENDADO",
  "NO_VINO",
  "REVISAR_NOTA",
  "GRABAR_SESION",
  "TERMINAR_SESION",
  "PAUSAR",
  "REANUDAR",
  "GUARDANDO",
  "FALTA_AUTORIZACION",
  "FIRMAR_AUTORIZACION",
  "AUTORIZACION_GRABACION",
  "AUDIO_NO_GUARDADO",
  "NOTA_NO_ESCRITA",
  "ALGO_FALLO",
] as const;

describe("glosario — constantes de texto", () => {
  it.each(CONSTANTES_REQUERIDAS)("%s existe y no está vacía", (nombre) => {
    const valor = (glosario as Record<string, unknown>)[nombre];
    expect(typeof valor).toBe("string");
    expect((valor as string).trim().length).toBeGreaterThan(0);
  });

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
});
