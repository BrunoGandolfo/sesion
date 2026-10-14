// La regla del service worker (src/lib/sw-politica.ts), comprobada sobre el
// service worker de verdad (src/app/sw.ts) con Serwist reemplazado por un
// doble que anota con qué opciones se lo construyó. Debe quedar cierto que:
//   - se precargan sólo los estáticos de la app y /sin-conexion;
//   - las navegaciones van a la red sin guardarse (NetworkOnly) y, si
//     fallan, se muestra /sin-conexion;
//   - NUNCA se guarda /api/** ni el HTML de otra ruta: ninguna ruta del
//     service worker atiende una llamada a la API, y la única que existe
//     (navegaciones) no guarda nada;
//   - skipWaiting y clientsClaim están prendidos.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  ACTUALIZACION,
  esNavegacion,
  precargaPermitida,
  RUTA_SIN_CONEXION,
  sePuedeGuardar,
  URL_SW,
} from "@/lib/sw-politica";

const construido = vi.hoisted(() => ({ opciones: null as Record<string, unknown> | null, escucha: false }));

vi.mock("serwist", () => {
  class NetworkOnly {
    readonly tipo = "NetworkOnly";
  }
  class Serwist {
    constructor(opciones: Record<string, unknown>) {
      construido.opciones = opciones;
    }
    addEventListeners() {
      construido.escucha = true;
    }
  }
  return { NetworkOnly, Serwist };
});

// Lo que el build inyectaría en __SW_MANIFEST, con intrusos a propósito.
const MANIFIESTO = [
  { url: "/_next/static/chunks/app-abc123.js", revision: null },
  { url: "/_next/static/css/estilos-def456.css", revision: null },
  { url: "/_next/static/media/jakarta-789.woff2", revision: null },
  { url: RUTA_SIN_CONEXION, revision: "build-1" },
  { url: "/api/dashboard", revision: "x" },
  { url: "/pacientes/abc", revision: "x" },
  "/sesiones/123",
];

type Ruta = { matcher: (o: { request: { mode: string; method: string }; url: URL }) => boolean; handler: { tipo?: string } };

function pedido(ruta: string, mode: string, method = "GET") {
  return { request: { mode, method }, url: new URL(ruta, "https://sesionapp.app") };
}

beforeAll(async () => {
  vi.stubGlobal("self", { __SW_MANIFEST: MANIFIESTO });
  await import("@/app/sw");
});

describe("service worker — qué se guarda en el teléfono", () => {
  it("precarga sólo estáticos y /sin-conexion: ni /api ni el HTML de otra ruta", () => {
    const urls = (construido.opciones?.precacheEntries as { url: string }[]).map((e) => (typeof e === "string" ? e : e.url));
    expect(urls).toEqual([
      "/_next/static/chunks/app-abc123.js",
      "/_next/static/css/estilos-def456.css",
      "/_next/static/media/jakarta-789.woff2",
      RUTA_SIN_CONEXION,
    ]);
  });

  it("ninguna ruta del service worker atiende /api/**, por ningún método ni modo", () => {
    const rutas = construido.opciones?.runtimeCaching as Ruta[];
    for (const ruta of ["/api/dashboard", "/api/sesion-clinica?turnoId=t1", "/api/pacientes/abc", "/api/version"]) {
      for (const mode of ["cors", "same-origin", "no-cors"]) {
        for (const method of ["GET", "POST", "PATCH"]) {
          expect(rutas.some((r) => r.matcher(pedido(ruta, mode, method)))).toBe(false);
        }
      }
    }
  });

  it("la única ruta es la de navegaciones, y va a la red sin guardar nada", () => {
    const rutas = construido.opciones?.runtimeCaching as Ruta[];
    expect(rutas).toHaveLength(1);
    expect(rutas[0].handler.tipo).toBe("NetworkOnly");
    expect(rutas[0].matcher(pedido("/pacientes/abc", "navigate"))).toBe(true);
    // El RSC de Next y los prefetch no son navegaciones: ni los toca.
    expect(rutas[0].matcher(pedido("/pacientes/abc?_rsc=1", "cors"))).toBe(false);
    expect(rutas[0].matcher(pedido("/login", "navigate", "POST"))).toBe(false);
  });

  it("si la navegación falla se muestra /sin-conexion", () => {
    const { entries } = construido.opciones?.fallbacks as { entries: { url: string; matcher: Ruta["matcher"] }[] };
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe(RUTA_SIN_CONEXION);
    expect(entries[0].matcher(pedido("/grabar/t1", "navigate"))).toBe(true);
    expect(entries[0].matcher(pedido("/api/dashboard", "cors"))).toBe(false);
  });

  it("no usa el defaultCache del ejemplo de Serwist (guarda API y páginas)", () => {
    // El código, sin los comentarios (que sí lo nombran para explicar por qué no).
    const fuente = readFileSync(join(process.cwd(), "src/app/sw.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/defaultCache/);
    expect(fuente).not.toMatch(/CacheFirst|NetworkFirst|StaleWhileRevalidate/);
  });

  it("se registra para escuchar", () => {
    expect(construido.escucha).toBe(true);
  });
});

describe("service worker — actualizaciones", () => {
  it("skipWaiting y clientsClaim prendidos, y borra la precarga vieja", () => {
    expect(ACTUALIZACION).toEqual({ skipWaiting: true, clientsClaim: true });
    expect(construido.opciones).toMatchObject({
      skipWaiting: true,
      clientsClaim: true,
      precacheOptions: { cleanupOutdatedCaches: true },
    });
  });
});

describe("sePuedeGuardar", () => {
  it("acepta estáticos y la pantalla sin conexión, rechaza todo lo demás", () => {
    expect(sePuedeGuardar("/_next/static/chunks/x.js")).toBe(true);
    expect(sePuedeGuardar("https://sesionapp.app/sin-conexion")).toBe(true);
    expect(sePuedeGuardar("https://sesionapp.app/sin-conexion?x=1")).toBe(true);
    expect(sePuedeGuardar("https://sesionapp.app/api/x")).toBe(false);
    for (const url of ["/api/x", "/", "/grabar/t1", "/sin-conexion/otra", "/pacientes/1", "/_next/image?url=x", URL_SW]) {
      expect(sePuedeGuardar(url)).toBe(false);
    }
  });

  it("precargaPermitida tolera un manifiesto ausente", () => {
    expect(precargaPermitida(undefined)).toEqual([]);
  });

  it("esNavegacion pide modo navigate y GET", () => {
    expect(esNavegacion(pedido("/", "navigate"))).toBe(true);
    expect(esNavegacion(pedido("/", "cors"))).toBe(false);
  });
});
