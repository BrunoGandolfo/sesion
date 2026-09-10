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
  leerCuerpoConTope,
  MAX_BYTES,
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
  it.each([
    ["document-uri", "documentURL"],
    ["blocked-uri", "blockedURL"],
    ["source-file", "sourceFile"],
  ])("redacta tokens en %s y %s antes de loguear", (clasico, moderno) => {
    const url = "https://sesionapp.app/restablecer?token=abc-secreto&modo=prueba&token=abc-otro";
    for (const cuerpo of [
      { "csp-report": { [clasico]: url } },
      [{ type: "csp-violation", body: { [moderno]: url } }],
    ]) {
      const linea = formatearViolacion(normalizarReportes(cuerpo)[0]);
      expect(linea).not.toContain("abc");
      expect(linea).toContain("?token=<redactado>&modo=prueba&token=<redactado>");
    }
  });

  it("redacta también claves codificadas y tokens largos antes de recortar", () => {
    const [v] = normalizarReportes({ documentURL: `https://sesionapp.app/registro?%74oken=${"abc".repeat(MAX_CAMPO)}&vista=1` });
    expect(formatearViolacion(v)).not.toContain("abc");
    expect(v.documento).toBe("https://sesionapp.app/registro?%74oken=<redactado>&vista=1");
  });

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

// ---------------------------------------------------------------------------
// Inyeccion en el log (Codex, P2 sobre el PR #16).
//
// El endpoint es publico y sin sesion: cualquiera puede postearle lo que
// quiera. Como el formato es UNA LINEA por violacion y los campos van entre
// comillas, un salto de linea o una comilla adentro de un campo alcanzaban
// para escribir lineas enteras inventadas en el log -- justo el log que hay
// que leer durante cuatro semanas para decidir si la CSP pasa a enforce.
// ---------------------------------------------------------------------------

describe("nadie puede escribir lineas propias en el log", () => {
  /** Un reporte con `blocked-uri` envenenado, ya formateado. */
  function conBloqueado(valor: string): string {
    return formatearViolacion(
      normalizarReportes({ "csp-report": { "blocked-uri": valor } })[0],
    );
  }

  it("un salto de linea no parte la linea en dos", () => {
    const linea = conBloqueado(
      'inline\n[csp] directiva="script-src" bloqueado="todo-bien"',
    );

    expect(linea.split("\n")).toHaveLength(1);
  });

  // Cada caso en su propio array, como los de mas arriba: `it.each` trata
  // los arrays como tuplas de argumentos.
  it.each([
    ["\n"], // salto de linea
    ["\r"], // retorno de carro
    [String.fromCharCode(0)], // nulo
    [String.fromCharCode(27)], // escape, el de los colores de terminal
    [String.fromCharCode(127)], // delete
    [String.fromCharCode(0x2028)], // separador de linea de Unicode
  ])("el control %j se reemplaza por un espacio", (control: string) => {
    expect(conBloqueado(`a${control}b`)).toContain('bloqueado="a b"');
  });

  it("una comilla no cierra el campo antes de tiempo", () => {
    // Sin escapar, esto terminaba el valor de `bloqueado` y todo lo que
    // seguia parecia un campo mas, puesto por el servidor.
    const linea = conBloqueado('inline" directiva="script-src');

    expect(linea).toContain('bloqueado="inline\\" directiva=\\"script-src"');
  });

  it("la barra se escapa a si misma, asi una comilla no se cuela detras", () => {
    expect(conBloqueado("a\\b")).toContain('bloqueado="a\\\\b"');
  });

  it("un campo limpio queda exactamente igual que antes", () => {
    // El escapado no puede ensuciar el 99% de los reportes, que son URLs
    // normales sin nada raro.
    expect(conBloqueado("https://sesion.uy/x.js")).toContain(
      'bloqueado="https://sesion.uy/x.js"',
    );
  });
});

// ---------------------------------------------------------------------------
// El tope de tamano del cuerpo (Codex, P2 sobre el PR #16).
//
// El endpoint es publico: lo postea el navegador de cualquiera, sin sesion.
// Antes el cuerpo se leia entero con request.text() y recien despues se lo
// media, asi que un POST sin `content-length` (o con uno que miente) hacia
// que el servidor cargara en memoria lo que el que postea quisiera. Ahora el
// tope se aplica MIENTRAS se lee.
// ---------------------------------------------------------------------------

describe("leerCuerpoConTope", () => {
  function postear(cuerpo: string): Request {
    return new Request("https://sesion.uy/api/csp-report", {
      method: "POST",
      body: cuerpo,
    });
  }

  it("devuelve el cuerpo entero cuando entra en el tope", async () => {
    const cuerpo = JSON.stringify(CLASICO);
    expect(await leerCuerpoConTope(postear(cuerpo))).toBe(cuerpo);
  });

  it("devuelve null cuando se pasa, sin juntarlo entero", async () => {
    const enorme = "x".repeat(MAX_BYTES + 1);
    expect(await leerCuerpoConTope(postear(enorme))).toBeNull();
  });

  it("sin cuerpo devuelve la cadena vacia, no null", async () => {
    // null es "se paso del tope"; un GET sin cuerpo no es eso.
    const sinCuerpo = new Request("https://sesion.uy/api/csp-report");
    expect(await leerCuerpoConTope(sinCuerpo)).toBe("");
  });

  it("el tope se mide en bytes, no en caracteres", async () => {
    // Un caracter acentuado ocupa dos bytes en UTF-8. Con la medida vieja
    // (crudo.length, que cuenta caracteres) esto pasaba el control.
    const seisAcentos = "á".repeat(6); // 6 caracteres, 12 bytes
    expect(await leerCuerpoConTope(postear(seisAcentos), 10)).toBeNull();
  });

  it("no parte un caracter multibyte al decodificar", async () => {
    const conAcentos = '{"paciente":"Lucía Gómez"}';
    expect(await leerCuerpoConTope(postear(conAcentos))).toBe(conAcentos);
  });

  it("justo en el tope todavia entra", async () => {
    const justo = "x".repeat(16);
    expect(await leerCuerpoConTope(postear(justo), 16)).toBe(justo);
  });
});
