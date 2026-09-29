/**
 * Guardián: un cuerpo que no es JSON es un 400, nunca un 500.
 *
 * Antes, `request.json()` lanzaba `SyntaxError`, `errorResponse` no lo
 * conocía y 23 rutas contestaban 500 "Error interno" (y el worker reintentaba
 * lo que nunca iba a pasar). Ahora las rutas leen el cuerpo con `leerJson`
 * (_lib/responses.ts), que lo traduce a 400 "JSON inválido" en el borde.
 *
 * Dos comprobaciones, las dos contra el DISCO, como en
 * rutas-sin-prisma.test.ts, así una ruta nueva entra sola:
 *   - ninguna ruta lee el cuerpo con `request.json()` pelado;
 *   - a cada método exportado que lo lee con `leerJson` se le manda `{` y
 *     tiene que contestar 400.
 *
 * La sesión, el ticket del worker y el control de origen del hilo se
 * mockean: el cuerpo se lee después de autenticar, y lo que se prueba acá es
 * qué pasa con el cuerpo, no quién pide. La base también se mockea con un
 * objeto vacío: si una ruta tocara la base ANTES de leer el cuerpo, el test
 * lo mostraría como un 500 en vez de pasar en silencio.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const ACTOR = {
  organizationId: "org",
  userId: "user",
  sesionId: "sesion-acceso",
  rol: "titular",
  nombre: "Nombre",
  email: "a@b.c",
};

vi.mock("@/app/api/_lib/auth", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/auth")>()),
  getSessionActor: vi.fn(async () => ACTOR),
  getOrganizationId: vi.fn(async () => ACTOR.organizationId),
  buscarActor: vi.fn(async () => ACTOR),
}));

vi.mock("@/app/api/_lib/tickets", () => ({
  autorizarTicketSesion: vi.fn(async (_r: Request, _db: unknown, sesionId: string) => ({
    sesionId,
    organizationId: "org",
  })),
  autorizarTicketTrabajo: vi.fn(async (_r: Request, _db: unknown, id: string) => ({ id, organizationId: "org" })),
}));

vi.mock("@/app/api/_lib/hilo-http", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/hilo-http")>()),
  autorizarEdicionHilo: vi.fn(async () => ACTOR),
}));

const RAIZ_API = join(process.cwd(), "src", "app", "api");
const METODOS = ["POST", "PATCH", "PUT", "DELETE"] as const;

/**
 * Rutas que leen el cuerpo a su manera y a propósito NO contestan 400, con
 * el motivo. La lista es corta a propósito.
 */
const EXCEPCIONES: Record<string, string> = {
  // `request.json().catch(() => null)`: contesta lo mismo pase lo que pase,
  // porque la respuesta no puede revelar nada sobre el email (ni siquiera si
  // el cuerpo se pudo leer).
  "cuenta/recuperar/route.ts": "respuesta pública constante",
};

function rutasDelDisco(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...rutasDelDisco(ruta));
    else if (nombre === "route.ts") salida.push(ruta);
  }
  return salida.sort();
}

/** El texto de cada método exportado, hasta el próximo `export`. */
function metodosQueLeenElCuerpo(fuente: string): string[] {
  return METODOS.filter((m) => {
    const inicio = fuente.search(new RegExp(`export\\s+async\\s+function\\s+${m}\\b`));
    if (inicio < 0) return false;
    const resto = fuente.slice(inicio + 1);
    const fin = resto.search(/\nexport\s/);
    const cuerpo = fin < 0 ? resto : resto.slice(0, fin);
    return /leerJson\(request\)/.test(cuerpo);
  });
}

const rutas = rutasDelDisco(RAIZ_API).map((abs) => ({
  abs,
  rel: relative(RAIZ_API, abs).split("\\").join("/"),
  fuente: readFileSync(abs, "utf8"),
}));

const casos = rutas.flatMap(({ abs, rel, fuente }) =>
  metodosQueLeenElCuerpo(fuente).map((metodo) => ({ rel, abs, metodo })),
);

describe("un cuerpo que no es JSON es 400 'JSON inválido'", () => {
  it("encuentra las rutas con cuerpo en el disco", () => {
    // 23 rutas leían el cuerpo cuando se escribió este test.
    expect(casos.length).toBeGreaterThanOrEqual(20);
  });

  it("ninguna ruta lee el cuerpo con request.json() pelado (se usa leerJson)", () => {
    const peladas = rutas
      .filter(({ rel, fuente }) => !(rel in EXCEPCIONES) && /request\.json\(\)/.test(fuente))
      .map(({ rel }) => rel);
    expect(peladas).toEqual([]);
  });

  it("toda excepción sigue existiendo y sigue leyendo el cuerpo a su manera", () => {
    for (const rel of Object.keys(EXCEPCIONES)) {
      const fuente = readFileSync(join(RAIZ_API, rel), "utf8");
      expect(/request\.json\(\)/.test(fuente), `${rel}: sacarla de EXCEPCIONES`).toBe(true);
    }
  });

  it.each(casos.map((c) => [`${c.metodo} ${c.rel}`, c]))("%s", async (_nombre, { abs, metodo }) => {
    const modulo = (await import(abs)) as Record<string, (r: Request, ctx: unknown) => Promise<Response>>;
    const respuesta = await modulo[metodo](
      new Request("http://localhost/api/x", {
        method: metodo,
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      { params: Promise.resolve({ id: "id-1", propuestaId: "propuesta-1", version: "1" }) },
    );
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "JSON inválido" });
  });
});
