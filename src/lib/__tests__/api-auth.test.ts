import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// getSessionActor lee cookies() y la base: se doblan los dos.
const cookieActual = vi.hoisted(() => ({ valor: null as string | null }));
const base = vi.hoisted(() => ({
  fila: null as null | Record<string, unknown>,
  actualizadas: 0,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieActual.valor ? { value: cookieActual.valor } : undefined) }),
}));
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  // Sin el cache() de React entre tests: cada llamada resuelve de nuevo.
  return { ...real, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/db", () => ({
  db: {
    sesionAcceso: {
      findUnique: async () => base.fila,
      updateMany: async () => {
        base.actualizadas += 1;
        return { count: 1 };
      },
    },
  },
}));

import {
  bearerDe,
  buscarActor,
  getSessionActor,
  hashTicket,
  nuevoTicket,
  requireBearer,
  requireCron,
  requireM2M,
  secretosDe,
  TICKET,
  ticketDe,
} from "@/app/api/_lib/auth";

const SECRET = "secreto-de-prueba-m2m";
const ORIGINAL = process.env.PROCESSING_SECRET;

function requestCon(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/sesion-clinica/pendientes", { headers });
}

beforeAll(() => {
  process.env.PROCESSING_SECRET = SECRET;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.PROCESSING_SECRET;
  else process.env.PROCESSING_SECRET = ORIGINAL;
});
afterEach(() => {
  cookieActual.valor = null;
  base.fila = null;
  base.actualizadas = 0;
});

describe("secretosDe", () => {
  it("parte por coma, recorta y descarta vacíos", () => {
    expect(secretosDe("a, b,,c ")).toEqual(["a", "b", "c"]);
    expect(secretosDe(undefined)).toEqual([]);
    expect(secretosDe(" , ")).toEqual([]);
  });
});

describe("requireM2M", () => {
  it("devuelve null con el Bearer correcto", () => {
    expect(requireM2M(requestCon(`Bearer ${SECRET}`))).toBeNull();
  });

  it("acepta cualquiera de los valores de la lista (rotación sin ventana)", () => {
    process.env.PROCESSING_SECRET = `viejo-secreto,${SECRET}`;
    expect(requireM2M(requestCon("Bearer viejo-secreto"))).toBeNull();
    expect(requireM2M(requestCon(`Bearer ${SECRET}`))).toBeNull();
    expect(requireM2M(requestCon("Bearer otro"))?.status).toBe(401);
    process.env.PROCESSING_SECRET = SECRET;
  });

  it("devuelve 401 con Bearer incorrecto, sin header, con Basic o con un carácter de más", async () => {
    const res = requireM2M(requestCon("Bearer otro-secreto"));
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toEqual({ error: "No autorizado" });
    expect(requireM2M(requestCon())?.status).toBe(401);
    expect(requireM2M(requestCon(`Basic ${Buffer.from(`u:${SECRET}`).toString("base64")}`))?.status).toBe(401);
    expect(requireM2M(requestCon(`Bearer ${SECRET}x`))?.status).toBe(401);
  });

  it("devuelve 401 siempre si PROCESSING_SECRET no está o está vacío", () => {
    delete process.env.PROCESSING_SECRET;
    try {
      expect(requireM2M(requestCon("Bearer "))?.status).toBe(401);
      expect(requireM2M(requestCon(`Bearer ${SECRET}`))?.status).toBe(401);
    } finally {
      process.env.PROCESSING_SECRET = SECRET;
    }
  });
});

describe("requireCron", () => {
  const SECRET_CRON = "secreto-de-prueba-cron";
  const ORIGINAL_CRON = process.env.CRON_SECRET;
  beforeAll(() => {
    process.env.CRON_SECRET = SECRET_CRON;
  });
  afterAll(() => {
    if (ORIGINAL_CRON === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_CRON;
  });

  it("autoriza con CRON_SECRET y no con PROCESSING_SECRET: los secretos no se cruzan", () => {
    expect(requireCron(requestCon(`Bearer ${SECRET_CRON}`))).toBeNull();
    expect(requireCron(requestCon(`Bearer ${SECRET}`))?.status).toBe(401);
  });
});

describe("requireBearer y bearerDe", () => {
  it("bearerDe devuelve el valor o null", () => {
    expect(bearerDe(requestCon("Bearer abc"))).toBe("abc");
    expect(bearerDe(requestCon("Bearer "))).toBeNull();
    expect(bearerDe(requestCon("Token abc"))).toBeNull();
    expect(bearerDe(requestCon())).toBeNull();
  });

  it("requireBearer con secret undefined o vacío nunca autoriza", () => {
    expect(requireBearer(requestCon("Bearer abc"), "abc")).toBeNull();
    expect(requireBearer(requestCon("Bearer "), undefined)?.status).toBe(401);
    expect(requireBearer(requestCon("Bearer "), "")?.status).toBe(401);
  });
});

describe("tickets", () => {
  it("nuevoTicket es 32 bytes hex y ticketDe devuelve su hash", async () => {
    const t = nuevoTicket();
    expect(TICKET.test(t)).toBe(true);
    expect(await ticketDe(requestCon(`Bearer ${t}`))).toBe(await hashTicket(t));
    expect(await ticketDe(requestCon(`Bearer ${SECRET}`))).toBeNull();
    expect(await ticketDe(requestCon())).toBeNull();
  });
});

describe("getSessionActor", () => {
  const AHORA = Date.now();
  const filaViva = () => ({
    id: "s1",
    cerradaEn: null,
    venceEn: new Date(AHORA + 86_400_000),
    ultimoUsoEn: new Date(AHORA - 10 * 60_000),
    user: { id: "u1", organizationId: "o1", rol: "titular", nombre: "Mariana", email: "m@example.test" },
  });

  it("sin cookie → 401 (y buscarActor null)", async () => {
    expect(await buscarActor()).toBeNull();
    await expect(getSessionActor()).rejects.toMatchObject({ status: 401 });
  });

  it("con una cookie mal formada no consulta y da 401", async () => {
    cookieActual.valor = "no-es-un-token";
    await expect(getSessionActor()).rejects.toMatchObject({ status: 401 });
  });

  it("con sesión viva devuelve el actor completo y anota el uso (pasaron más de 5 min)", async () => {
    cookieActual.valor = "a".repeat(43);
    base.fila = filaViva();
    const actor = await getSessionActor();
    expect(actor).toEqual({
      organizationId: "o1", userId: "u1", sesionId: "s1", rol: "titular", nombre: "Mariana", email: "m@example.test",
    });
    expect(base.actualizadas).toBe(1);
  });

  it("con uso reciente no escribe", async () => {
    cookieActual.valor = "a".repeat(43);
    base.fila = { ...filaViva(), ultimoUsoEn: new Date(AHORA - 1000) };
    await getSessionActor();
    expect(base.actualizadas).toBe(0);
  });

  it("cerrada, vencida o inactiva → 401", async () => {
    cookieActual.valor = "a".repeat(43);
    base.fila = { ...filaViva(), cerradaEn: new Date(AHORA - 1000) };
    await expect(getSessionActor()).rejects.toMatchObject({ status: 401 });
    base.fila = { ...filaViva(), venceEn: new Date(AHORA - 1000) };
    await expect(getSessionActor()).rejects.toMatchObject({ status: 401 });
    base.fila = { ...filaViva(), ultimoUsoEn: new Date(AHORA - 15 * 86_400_000) };
    await expect(getSessionActor()).rejects.toMatchObject({ status: 401 });
  });
});
