// Guardián del catálogo de acciones de auditoría (src/lib/auditoria-acciones.ts).
//
// El tipo de `EventoAuditoriaInput.accion` ya obliga a que un nombre NUEVO
// entre al catálogo: lo que el tipo no ve es un literal que coincide con uno
// existente ("sesion.ver" escrito a mano compila igual). Eso es lo que este
// test prohíbe: fuera del catálogo y de los tests, ningún archivo de src
// escribe un valor del catálogo entre comillas, ni pasa una acción literal a
// quien audita.
//
// La lista de archivos sale del disco, como en proxy-liviano.test.ts: un
// archivo nuevo entra solo.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCIONES, TODAS_LAS_ACCIONES } from "@/lib/auditoria-acciones";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");
const CATALOGO = "src/lib/auditoria-acciones.ts";

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__") continue;
      salida.push(...archivos(ruta));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|spec)\.tsx?$/.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida.sort();
}

/** El código sin comentarios: un comentario puede nombrar la acción. */
export function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    // `//` precedido de `:` es una URL dentro de un string, no un comentario.
    .map((linea) => linea.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Los valores del catálogo que aparecen como literal en `fuente`. */
export function literalesDeAccion(fuente: string): string[] {
  const limpia = sinComentarios(fuente);
  return TODAS_LAS_ACCIONES.filter((accion) =>
    ["\"", "'", "`"].some((comilla) => limpia.includes(`${comilla}${accion}${comilla}`)),
  );
}

/** Quien escribe en eventos_auditoria (por la función o a mano). */
const AUDITA = /\b(?:auditar|registrarAuditoria|auditarHilo)\s*\(|\beventoAuditoria\s*\.\s*create/;
/** `accion: "…"`: una acción literal pasada a quien audita. */
const ACCION_LITERAL = /\baccion\s*:\s*["'`]/;

const todos = archivos(SRC).map((abs) => ({
  abs,
  rel: relative(RAIZ, abs).split("\\").join("/"),
}));

describe("catálogo de acciones de auditoría", () => {
  it("los valores son únicos y tienen la forma <entidad>.<acto>", () => {
    expect(new Set(TODAS_LAS_ACCIONES).size).toBe(TODAS_LAS_ACCIONES.length);
    for (const accion of TODAS_LAS_ACCIONES) expect(accion).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it("cada grupo nombra a su entidad", () => {
    for (const [grupo, acciones] of Object.entries(ACCIONES)) {
      for (const accion of Object.values(acciones)) expect(accion.startsWith(`${grupo}.`)).toBe(true);
    }
  });

  it("encuentra el código en el disco", () => {
    expect(todos.length).toBeGreaterThan(100);
    expect(todos.some(({ rel }) => rel === CATALOGO)).toBe(true);
  });

  it("la detección ve un literal y no ve un comentario", () => {
    expect(literalesDeAccion(`const a = "sesion.ver";`)).toEqual(["sesion.ver"]);
    expect(literalesDeAccion(`// deja un "sesion.ver"\nconst a = 1;`)).toEqual([]);
    expect(literalesDeAccion(`/* "turno.crear" */ const a = 1;`)).toEqual([]);
    expect(literalesDeAccion(`const a = ACCIONES.sesion.ver;`)).toEqual([]);
  });

  it.each(todos.filter(({ rel }) => rel !== CATALOGO).map(({ rel, abs }) => [rel, abs]))(
    "%s no escribe una acción como literal",
    (_rel, abs) => {
      const fuente = readFileSync(abs, "utf8");
      expect(literalesDeAccion(fuente)).toEqual([]);
      if (AUDITA.test(sinComentarios(fuente))) {
        expect(sinComentarios(fuente)).not.toMatch(ACCION_LITERAL);
      }
    },
  );
});

// auditoria.ts: UNA función escribe la fila. La única otra escritura es el
// createMany del alta de cuenta, que necesita dos eventos de dos
// organizaciones en la misma transacción que crea la organización.
const ESCRIBE_A_MANO = /\beventoAuditoria\s*\.\s*(?:create|createMany)\s*\(/;
const ESCRIBEN_A_MANO = ["src/app/api/_lib/auditoria.ts", "src/lib/cuenta-registro-db.ts"];

describe("nadie escribe en eventos_auditoria por fuera de auditar()", () => {
  it("sólo auditoria.ts y el alta de cuenta tocan eventoAuditoria.create*", () => {
    const escriben = todos
      .filter(({ abs }) => ESCRIBE_A_MANO.test(sinComentarios(readFileSync(abs, "utf8"))))
      .map(({ rel }) => rel);
    expect(escriben).toEqual(ESCRIBEN_A_MANO);
  });
});

// Ninguna ruta audita: el evento es parte del acto y el acto vive en su caso
// de uso (dentro de su transacción cuando la hay). Una ruta que audita
// después del caso de uso deja el rastro fuera del acto y, si responde antes,
// lo pierde.
const RAIZ_API = "src/app/api/";
const AUDITA_EN_RUTA = /\b(?:auditar|registrarAuditoria)\s*\(|_lib\/auditoria["']/;
/** Las que todavía auditan, con el bloque que las mueve. Tiene que quedar vacía. */
const RUTAS_QUE_AUDITAN_PENDIENTES: Record<string, string> = {
  "sesion-clinica/[id]/route.ts": "bloque 4: verSesion",
  "cuenta/password/route.ts": "bloque 5: cambiarPassword",
  "pacientes/[id]/documentacion/route.ts": "bloque 5: exportarDocumentacion",
};

describe("ninguna ruta de src/app/api audita", () => {
  const rutas = todos
    .filter(({ rel }) => rel.startsWith(RAIZ_API) && rel.endsWith("/route.ts"))
    .map(({ abs, rel }) => ({ abs, rel: rel.slice(RAIZ_API.length) }));

  it("encuentra las rutas en el disco", () => {
    expect(rutas.length).toBeGreaterThan(40);
  });

  it.each(rutas.filter(({ rel }) => !(rel in RUTAS_QUE_AUDITAN_PENDIENTES)).map(({ rel, abs }) => [rel, abs]))(
    "%s",
    (_rel, abs) => {
      expect(sinComentarios(readFileSync(abs, "utf8"))).not.toMatch(AUDITA_EN_RUTA);
    },
  );

  it("cada pendiente sigue auditando (si ya no, sacarla de la lista)", () => {
    for (const rel of Object.keys(RUTAS_QUE_AUDITAN_PENDIENTES)) {
      const ruta = rutas.find((r) => r.rel === rel);
      expect(ruta, `${rel} ya no existe`).toBeDefined();
      expect(sinComentarios(readFileSync(ruta!.abs, "utf8"))).toMatch(AUDITA_EN_RUTA);
    }
  });
});
