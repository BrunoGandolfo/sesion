import { describe, expect, it } from "vitest";

import { limpiarTexto, MAX_MENSAJE, sanearBreadcrumb, sanearEvento, urlSinQuery } from "@/lib/telemetria-saneo";

describe("limpiarTexto", () => {
  it("tapa emails, teléfonos y tokens largos, y acota el largo", () => {
    const t = limpiarTexto(`falló para mariana@example.test tel +59899123456 token ${"a".repeat(43)}`)!;
    expect(t).not.toContain("mariana@");
    expect(t).not.toContain("+59899123456");
    expect(t).not.toContain("a".repeat(43));
    expect(t).toContain("[email]");
    expect(t).toContain("[tel]");
    expect(t).toContain("[token]");
    // Con espacios, para que no lo tape el patrón de tokens largos.
    const largo = limpiarTexto("palabra ".repeat(40))!; // 320 chars
    expect(largo.length).toBeLessThan(MAX_MENSAJE + 40);
    expect(largo).toContain("[truncado 120 chars]");
    expect(limpiarTexto(42)).toBeUndefined();
  });
});

describe("urlSinQuery", () => {
  it("deja origen y ruta; nunca la query, el fragmento ni el userinfo", () => {
    expect(urlSinQuery("https://sesionapp.app/restablecer?token=abc#x")).toBe("https://sesionapp.app/restablecer");
    expect(urlSinQuery("https://u:p@sesionapp.app/x")).toBe("https://sesionapp.app/x");
    expect(urlSinQuery("/api/pacientes/1?q=secreto")).toBe("/api/pacientes/1");
    expect(urlSinQuery("")).toBeUndefined();
    expect(urlSinQuery(null)).toBeUndefined();
  });
});

describe("sanearEvento: lista de permitidos", () => {
  const evento = {
    event_id: "e1",
    level: "error",
    environment: "production",
    message: "Prisma falló con mariana@example.test",
    exception: { values: [{ type: "PrismaClientKnownRequestError", value: "notas = 'texto clínico' tel +59899123456", stacktrace: { frames: [] } }] },
    request: {
      method: "POST",
      url: "https://sesionapp.app/api/pacientes/1?q=secreto",
      data: { notas: "texto clínico" },
      cookies: { "__Host-sesion": "token" },
      headers: { cookie: "x", authorization: "Bearer y", "user-agent": "z" },
      query_string: "q=secreto",
    },
    user: { id: "u1", email: "mariana@example.test", ip_address: "1.2.3.4" },
    extra: { body: { nota: "texto" } },
    tags: { runtime: "node", paciente: "María", url: "https://x/y?z=1" },
    contexts: { runtime: { name: "node" }, paciente: { nombre: "María" }, trace: { trace_id: "t" } },
    breadcrumbs: [{ category: "console", message: "todo" }],
    transaction: "/api/x?y=1",
  };

  it("conserva solo lo permitido y limpia lo que conserva", () => {
    const s = sanearEvento(evento) as unknown as Record<string, unknown>;
    expect(s).toEqual({
      event_id: "e1",
      level: "error",
      environment: "production",
      transaction: "/api/x",
      message: "Prisma falló con [email]",
      exception: { values: [{ type: "PrismaClientKnownRequestError", value: "notas = 'texto clínico' tel [tel]", stacktrace: { frames: [] } }] },
      request: { method: "POST", url: "https://sesionapp.app/api/pacientes/1" },
      tags: { runtime: "node", url: "https://x/y" },
      contexts: { runtime: { name: "node" }, trace: { trace_id: "t" } },
    });
    const json = JSON.stringify(s);
    for (const prohibido of ["cookie", "authorization", "user-agent", "secreto", "María", "1.2.3.4", "u1", "breadcrumbs", "body"]) {
      expect(json).not.toContain(prohibido);
    }
  });

  it("un evento vacío sale vacío, no rompe", () => {
    expect(sanearEvento({})).toEqual({});
  });
});

describe("sanearBreadcrumb", () => {
  it("consola afuera entera", () => {
    expect(sanearBreadcrumb({ category: "console", message: "console.error(paciente)", data: { arguments: ["x"] } })).toBeNull();
  });

  it("fetch/xhr: método, ruta sin query y status; nada más", () => {
    expect(
      sanearBreadcrumb({ category: "fetch", type: "http", data: { method: "GET", url: "/api/pacientes?q=secreto", status_code: 200, body: "x", request_body_size: 3 } }),
    ).toEqual({ category: "fetch", type: "http", data: { method: "GET", url: "/api/pacientes", status_code: 200 } });
  });

  it("navegación: rutas sin query", () => {
    expect(sanearBreadcrumb({ category: "navigation", data: { from: "/restablecer?token=abc", to: "/login?aviso=x" } })).toEqual({
      category: "navigation",
      data: { from: "/restablecer", to: "/login" },
    });
  });

  it("otros: categoría, nivel y mensaje limpio", () => {
    expect(sanearBreadcrumb({ category: "ui.click", level: "info", message: "click mariana@example.test", data: { target: "x" } })).toEqual({
      category: "ui.click",
      level: "info",
      message: "click [email]",
    });
  });
});
