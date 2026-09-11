// El proxy: qué deja pasar sin cookie, a dónde manda, y el chequeo de Origin.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PARAM_SESION_VENCIDA, proxy } from "@/proxy";
import { nombreCookie } from "@/lib/sesion-cookie";

const HOST = "https://sesionapp.app";
const TOKEN = "a".repeat(43);

function pedido(ruta: string, opciones: { cookie?: boolean; method?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ host: "sesionapp.app", ...opciones.headers });
  if (opciones.cookie) headers.set("cookie", `${nombreCookie()}=${TOKEN}`);
  return new NextRequest(`${HOST}${ruta}`, { method: opciones.method ?? "GET", headers });
}

describe("sin cookie", () => {
  it.each(["/login", "/registro", "/terminos", "/recuperar", "/restablecer", "/api/cuenta/registro", "/api/cuenta/recuperar", "/api/cuenta/restablecer"])(
    "permite %s y conserva la CSP",
    (ruta) => {
      const r = proxy(pedido(ruta));
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
      expect(r.headers.get("Reporting-Endpoints")).toBeTruthy();
    },
  );

  it("permite POST /api/cuenta/entrar desde el propio sitio", () => {
    expect(proxy(pedido("/api/cuenta/entrar", { method: "POST", headers: { origin: HOST } })).status).toBe(200);
  });

  it.each(["/", "/config", "/api/cuenta/invitaciones", "/api/cuenta/salir", "/api/cuenta/recuperar/otra"])(
    "manda %s a /login",
    (ruta) => {
      const r = proxy(pedido(ruta));
      expect(r.headers.get("location")).toBe(`${HOST}/login`);
      expect(r.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
    },
  );
});

describe("con cookie", () => {
  it("deja pasar el dashboard sin validar nada (eso es de las rutas)", () => {
    const r = proxy(pedido("/", { cookie: true }));
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
  });

  it("/login redirige a /", () => {
    expect(proxy(pedido("/login", { cookie: true })).headers.get("location")).toBe(`${HOST}/`);
  });

  it("/login?sesion=vencida NO redirige: el layout mandó acá con una cookie muerta", () => {
    const r = proxy(pedido(`/login?${PARAM_SESION_VENCIDA}=vencida`, { cookie: true }));
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
  });

  it("le pasa el nonce al renderizador por las cabeceras del pedido", () => {
    const r = proxy(pedido("/", { cookie: true }));
    const politica = r.headers.get("Content-Security-Policy-Report-Only")!;
    expect(politica).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });
});

describe("Origin (CSRF)", () => {
  it("un POST con Origin ajeno recibe 403 aunque haya cookie", async () => {
    const r = proxy(pedido("/api/cuenta/password", { cookie: true, method: "POST", headers: { origin: "https://malo.example" } }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Origen no permitido" });
    expect(r.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
  });

  it("un POST sin Origin pero cross-site también", () => {
    const r = proxy(pedido("/api/cuenta/password", { cookie: true, method: "POST", headers: { "sec-fetch-site": "cross-site" } }));
    expect(r.status).toBe(403);
  });

  it("un POST propio pasa", () => {
    const r = proxy(pedido("/api/cuenta/password", { cookie: true, method: "POST", headers: { origin: HOST } }));
    expect(r.status).toBe(200);
  });

  it("un GET con Origin ajeno pasa: el navegador lo manda en cualquier navegación", () => {
    const r = proxy(pedido("/", { cookie: true, headers: { origin: "https://malo.example" } }));
    expect(r.status).toBe(200);
  });
});
