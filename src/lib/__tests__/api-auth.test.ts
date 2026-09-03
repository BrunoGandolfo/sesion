import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// _lib/auth importa auth-utils → next-auth. Se mockea para que el test no
// inicialice NextAuth; requireM2M no lo usa.
vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: vi.fn(),
  getServerSession: vi.fn(),
}));

import { requireM2M } from "@/app/api/_lib/auth";

const SECRET = "secreto-de-prueba-m2m";
const ORIGINAL = process.env.PROCESSING_SECRET;

function requestCon(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/sesion-clinica/pendientes", {
    headers,
  });
}

beforeAll(() => {
  process.env.PROCESSING_SECRET = SECRET;
});

afterAll(() => {
  if (ORIGINAL === undefined) {
    delete process.env.PROCESSING_SECRET;
  } else {
    process.env.PROCESSING_SECRET = ORIGINAL;
  }
});

describe("requireM2M", () => {
  it("devuelve null con el Bearer correcto", () => {
    expect(requireM2M(requestCon(`Bearer ${SECRET}`))).toBeNull();
  });

  it("devuelve 401 con Bearer incorrecto", async () => {
    const res = requireM2M(requestCon("Bearer otro-secreto"));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toEqual({ error: "No autorizado" });
  });

  it("devuelve 401 sin header Authorization", () => {
    const res = requireM2M(requestCon());
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 con esquema distinto (Basic)", () => {
    const basic = Buffer.from(`user:${SECRET}`).toString("base64");
    const res = requireM2M(requestCon(`Basic ${basic}`));
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 si el secret trae un carácter de más", () => {
    const res = requireM2M(requestCon(`Bearer ${SECRET}x`));
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 siempre si PROCESSING_SECRET no está configurado", () => {
    delete process.env.PROCESSING_SECRET;
    try {
      const res = requireM2M(requestCon("Bearer "));
      expect(res?.status).toBe(401);
    } finally {
      process.env.PROCESSING_SECRET = SECRET;
    }
  });
});
