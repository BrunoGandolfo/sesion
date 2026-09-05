// Cómo se leen las violaciones de CSP que postea el navegador.
//
// Los dos formatos existen de verdad y ningún navegador garantiza cuál usa:
// `application/csp-report` (viejo, kebab-case, envuelto en `csp-report`) y
// `application/reports+json` (Reporting API, camelCase, un array de
// `{type, body}`). Si sólo se soportara uno, la mitad de los reportes se
// perdería en silencio — y un endpoint de diagnóstico que pierde la mitad de
// los datos es peor que no tenerlo, porque da confianza falsa.
//
// El otro grupo de casos es el de lo que NO tiene que salir en el log.

import { describe, expect, it } from "vitest";

import {
  formatearViolacion,
  MAX_CAMPO,
  MAX_POR_POST,
  normalizarReportes,
} from "@/lib/csp-reportes";

const CLASICO = {
  "csp-report": {
    "document-uri": "https://sesion.uy/pacientes/abc",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "inline",
    "source-file": "https://sesion.uy/_next/static/chunks/main.js",
    "line-number": 42,
    disposition: "report",
  },
};

const MODERNO = [
  {
    type: "csp-violation",
    url: "https://sesion.uy/pacientes/abc",
    body: {
      documentURL: "https://sesion.uy/pacientes/abc",
      effectiveDirective: "script-src-elem",
      blockedURL: "inline",
      sourceFile: "https://sesion.uy/_next/static/chunks/main.js",
      lineNumber: 42,
      disposition: "report",
    },
  },
];

describe("normalizarReportes — los dos formatos dan lo mismo", () => {
  it("lee el formato clásico (application/csp-report)", () => {
    expect(normalizarReportes(CLASICO)).toEqual([
      {
        documento: "https://sesion.uy/pacientes/abc",
        directiva: "script-src-elem",
        bloqueado: "inline",
        archivo: "https://sesion.uy/_next/static/chunks/main.js",
        linea: "42",
        disposicion: "report",
      },
    ]);
  });

  it("lee el formato de la Reporting API, y da EXACTAMENTE lo mismo", () => {
    expect(normalizarReportes(MODERNO)).toEqual(normalizarReportes(CLASICO));
  });

  it("con `violated-directive` pero sin `effective-directive` usa el que hay", () => {
    // Safari manda uno y no el otro.
    const [v] = normalizarReportes({
      "csp-report": { "violated-directive": "style-src" },
    });
    expect(v.directiva).toBe("style-src");
  });

  it("un objeto suelto, sin envoltorio, también se lee", () => {
    const [v] = normalizarReportes({ "blocked-uri": "eval" });
    expect(v.bloqueado).toBe("eval");
  });

  it("descarta los reportes que no son de CSP", () => {
    // El array de la Reporting API mezcla deprecation e intervention.
    expect(
      normalizarReportes([
        { type: "deprecation", body: { id: "x" } },
        ...MODERNO,
        { type: "intervention", body: { id: "y" } },
      ]),
    ).toHaveLength(1);
  });
});

describe("normalizarReportes — lo que no puede pasar", () => {
  // Cada caso va envuelto en su propio array: `it.each` trata los arrays
  // como tuplas de argumentos, así que un `[]` suelto llamaría sin ninguno.
  it.each([[null], [undefined], [42], ["un string"], [[]], [{}], [[null, 7]]])(
    "con %j no lanza",
    (basura: unknown) => {
      // Es un endpoint público: un POST con cualquier cosa es internet, no
      // un error del servidor.
      expect(() => normalizarReportes(basura)).not.toThrow();
    },
  );

  it("un cuerpo vacío no produce ninguna línea de log", () => {
    expect(normalizarReportes(null)).toEqual([]);
    expect(normalizarReportes([])).toEqual([]);
  });

  it("un objeto vacío produce una violación con todo en blanco, no undefined", () => {
    // Que quede una línea vacía en el log es aceptable; que el formateo
    // rompa con undefined, no.
    expect(normalizarReportes({})).toEqual([
      {
        documento: "",
        directiva: "",
        bloqueado: "",
        archivo: "",
        linea: "",
        disposicion: "",
      },
    ]);
  });

  it("recorta los campos largos", () => {
    const largo = "x".repeat(MAX_CAMPO * 3);
    const [v] = normalizarReportes({ "csp-report": { "document-uri": largo } });

    // Una URL de esta app puede llevar el id de una paciente; el reporte
    // trae hasta 40 caracteres del script ofensor. Se recorta todo.
    expect(v.documento).toHaveLength(MAX_CAMPO + 1); // +1 por el "…"
    expect(v.documento.endsWith("…")).toBe(true);
  });

  it("no copia campos que no se nombraron", () => {
    // Un navegador puede sumar campos nuevos, y `script-sample` trae texto
    // de la página. Sólo salen los seis que se pidieron.
    const [v] = normalizarReportes({
      "csp-report": {
        "document-uri": "https://sesion.uy/",
        "script-sample": "const paciente = 'Lucía Gómez'",
        "campo-inventado": "algo",
      },
    });

    expect(Object.keys(v).sort()).toEqual([
      "archivo",
      "bloqueado",
      "directiva",
      "disposicion",
      "documento",
      "linea",
    ]);
    expect(JSON.stringify(v)).not.toContain("Lucía");
  });

  it("acota cuántos reportes salen de un solo POST", () => {
    // La Reporting API agrupa, y una extensión del navegador que inyecte
    // scripts puede generar cientos: no puede llenar el log de un saque.
    const muchos = Array.from({ length: 500 }, () => MODERNO[0]);
    expect(normalizarReportes(muchos)).toHaveLength(MAX_POR_POST);
  });
});

describe("formatearViolacion", () => {
  it("una línea greppable con los campos nombrados", () => {
    const [v] = normalizarReportes(CLASICO);

    expect(formatearViolacion(v)).toBe(
      '[csp] directiva="script-src-elem" bloqueado="inline" ' +
        'documento="https://sesion.uy/pacientes/abc" ' +
        'archivo="https://sesion.uy/_next/static/chunks/main.js:42" ' +
        'disposicion="report"',
    );
  });

  it("arranca con [csp] para poder filtrarlo del resto del log", () => {
    expect(formatearViolacion(normalizarReportes({})[0])).toMatch(/^\[csp\] /);
  });
});
