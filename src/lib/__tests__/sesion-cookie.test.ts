import { describe, expect, it } from "vitest";

import {
  cookieBorrada,
  cookieDeSesion,
  esOrigenPropio,
  esRutaPublica,
  nombreCookie,
  RUTAS_PUBLICAS,
  TOKEN_SESION,
  tokenDeCookieHeader,
  VIGENCIA_SESION_SEGUNDOS,
} from "@/lib/sesion-cookie";

const TOKEN = "a".repeat(43);

describe("la cookie", () => {
  it("se llama __Host-sesion en producción y sesion en desarrollo", () => {
    expect(nombreCookie(true)).toBe("__Host-sesion");
    expect(nombreCookie(false)).toBe("sesion");
  });

  it("en producción va HttpOnly, Secure, SameSite=Lax, Path=/ y 30 días", () => {
    const c = cookieDeSesion(TOKEN, true);
    expect(c).toContain(`__Host-sesion=${TOKEN}`);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", `Max-Age=${VIGENCIA_SESION_SEGUNDOS}`]) {
      expect(c).toContain(attr);
    }
    expect(VIGENCIA_SESION_SEGUNDOS).toBe(30 * 24 * 60 * 60);
    expect(c).not.toContain("Domain=");
  });

  it("en desarrollo no lleva Secure (http://localhost)", () => {
    expect(cookieDeSesion(TOKEN, false)).not.toContain("Secure");
  });

  it("la borrada tiene Max-Age=0 y el mismo nombre", () => {
    expect(cookieBorrada(true)).toMatch(/^__Host-sesion=; .*Max-Age=0/);
    expect(cookieBorrada(false)).toMatch(/^sesion=; .*Max-Age=0/);
  });

  it("lee el token de la cabecera Cookie solo si tiene la forma", () => {
    expect(tokenDeCookieHeader(`otra=1; sesion=${TOKEN}; x=2`, "sesion")).toBe(TOKEN);
    expect(tokenDeCookieHeader(`sesion=corto`, "sesion")).toBeNull();
    expect(tokenDeCookieHeader(`sesion=${TOKEN}`, "__Host-sesion")).toBeNull();
    expect(tokenDeCookieHeader(null, "sesion")).toBeNull();
    expect(TOKEN_SESION.test("a".repeat(42))).toBe(false);
    expect(TOKEN_SESION.test("a".repeat(43) + "=")).toBe(false);
  });
});

describe("rutas públicas", () => {
  it("son exactamente las de entrar, registrarse y recuperar", () => {
    expect(RUTAS_PUBLICAS).toEqual([
      "/login", "/registro", "/terminos", "/recuperar", "/restablecer",
      "/api/cuenta/entrar", "/api/cuenta/registro", "/api/cuenta/recuperar", "/api/cuenta/restablecer",
    ]);
  });

  it("la coincidencia es exacta: ni prefijos ni sufijos", () => {
    expect(esRutaPublica("/login")).toBe(true);
    expect(esRutaPublica("/login/")).toBe(false);
    expect(esRutaPublica("/api/cuenta/recuperar/otra")).toBe(false);
    expect(esRutaPublica("/api/cuenta/salir")).toBe(false);
    expect(esRutaPublica("/api/cuenta/password")).toBe(false);
  });
});

describe("esOrigenPropio (CSRF)", () => {
  const h = (pares: Record<string, string>) => ({ get: (n: string) => pares[n.toLowerCase()] ?? null });

  it("GET, HEAD y OPTIONS pasan siempre", () => {
    expect(esOrigenPropio("GET", h({ origin: "https://malo.example" }), "sesionapp.app")).toBe(true);
    expect(esOrigenPropio("head", h({}), "sesionapp.app")).toBe(true);
  });

  it("POST con Origin propio pasa; con Origin ajeno o inválido no", () => {
    expect(esOrigenPropio("POST", h({ origin: "https://sesionapp.app" }), "sesionapp.app")).toBe(true);
    expect(esOrigenPropio("POST", h({ origin: "https://malo.example" }), "sesionapp.app")).toBe(false);
    expect(esOrigenPropio("POST", h({ origin: "https://sesionapp.app.malo.example" }), "sesionapp.app")).toBe(false);
    expect(esOrigenPropio("POST", h({ origin: "null" }), "sesionapp.app")).toBe(false);
    expect(esOrigenPropio("POST", h({ origin: "https://sesionapp.app" }), null)).toBe(false);
  });

  it("sin Origin decide Sec-Fetch-Site: cross-site se rechaza, el resto pasa", () => {
    expect(esOrigenPropio("POST", h({ "sec-fetch-site": "cross-site" }), "sesionapp.app")).toBe(false);
    expect(esOrigenPropio("POST", h({ "sec-fetch-site": "same-origin" }), "sesionapp.app")).toBe(true);
    expect(esOrigenPropio("DELETE", h({ "sec-fetch-site": "none" }), "sesionapp.app")).toBe(true);
    expect(esOrigenPropio("PATCH", h({}), "sesionapp.app")).toBe(true);
  });
});
