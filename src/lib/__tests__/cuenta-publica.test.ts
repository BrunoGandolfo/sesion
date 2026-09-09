import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: (handler: unknown) => handler }));
import middleware from "@/middleware";
it.each(["/recuperar", "/restablecer", "/api/cuenta/recuperar", "/api/cuenta/restablecer"])("permite %s sin sesión y conserva CSP", async ruta => {
  const request = Object.assign(new NextRequest(`https://sesionapp.app${ruta}`), { auth: null });
  const respuesta = await middleware(request, { params: Promise.resolve({}) });
  expect(respuesta?.status).toBe(200);
  expect(respuesta?.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
});
it.each(["/", "/config", "/api/cuenta/password", "/api/cuenta/recuperar/otra"])("mantiene protegida %s", async ruta => {
  const request = Object.assign(new NextRequest(`https://sesionapp.app${ruta}`), { auth: null });
  const respuesta = await middleware(request, { params: Promise.resolve({}) });
  expect(respuesta?.headers.get("location")).toBe("https://sesionapp.app/login");
});
