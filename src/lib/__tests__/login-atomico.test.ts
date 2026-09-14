/**
 * Integración — entrar: el intento es atómico (pg_advisory_xact_lock, que
 * ningún doble imita), la sesión queda en sesiones_acceso y la ruta deja la
 * cookie. Contra la base de test (DATABASE_URL_TEST, esquema nuevo).
 */
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { iniciarSesion } from "@/app/api/_lib/casos-uso/iniciar-sesion";
import {
  claveEmail,
  claveUsuario,
  evaluarBloqueoDe,
  procesarIntentoLogin,
} from "@/lib/intentos-acceso";
import { tomarLocks } from "@/lib/intentos-serializados";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { UMBRAL_INTENTOS } from "@/lib/login-intentos";
import { BCRYPT_RONDAS } from "@/lib/password";
import {
  buscarSesionViva,
  cerrarSesion,
  cerrarTodas,
  hashTokenSesion,
  listarSesionesVivas,
} from "@/lib/sesion-acceso";
import { nombreCookie, tokenDeCookieHeader } from "@/lib/sesion-cookie";

import {
  CLAVES_CIFRADO_TEST,
  conectarBaseIdentidad,
  vaciarBaseIdentidad,
  type BaseIdentidad,
} from "./base-identidad";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseIdentidad }));
vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));

const AHORA = new Date("2026-09-05T15:00:00.000Z");
const HUELLA = { ip: "203.0.113.7", userAgent: "vitest" };
const EN_PARALELO = 12;

beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  estado.base = conectarBaseIdentidad();
});
beforeEach(() => vaciarBaseIdentidad(estado.base.prisma));
afterAll(() => estado.base.prisma.$disconnect());

async function cuenta(password = "contraseña larga y buena") {
  const org = await estado.base.prisma.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await estado.base.prisma.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: await bcrypt.hash(password, BCRYPT_RONDAS), nombre: "Mariana", organizationId: org.id },
  });
  return { org, user, password };
}

async function fallosDe(email: string) {
  return estado.base.prisma.intentoAcceso.count({ where: { tipo: "login", clave: await claveEmail(email) } });
}

describe("procesarIntentoLogin", () => {
  it("N intentos fallidos en paralelo no pasan del umbral y escriben un fallo por verificación", async () => {
    const email = `${randomUUID()}@test.uy`;
    let verificaciones = 0;
    const resultados = await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        procesarIntentoLogin<string>({
          prisma: estado.base.db,
          intento: { email, huella: HUELLA, ahora: AHORA },
          verificar: async () => {
            verificaciones += 1;
            return { ok: false, motivo: "password" };
          },
        }),
      ),
    );
    expect(resultados.every((r) => r.estado === "rechazado")).toBe(true);
    expect(verificaciones).toBe(UMBRAL_INTENTOS);
    expect(await fallosDe(email)).toBe(UMBRAL_INTENTOS);
    // También una fila por IP por cada fallo, con IP y user-agent.
    const porIp = await estado.base.prisma.intentoAcceso.findMany({ where: { clave: `ip:${HUELLA.ip}` } });
    expect(porIp).toHaveLength(UMBRAL_INTENTOS);
    expect(porIp[0]).toMatchObject({ tipo: "login", ip: HUELLA.ip, userAgent: "vitest" });
  });

  it("después de la tanda el email queda bloqueado y un intento bloqueado no escribe nada", async () => {
    const email = `${randomUUID()}@test.uy`;
    await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        procesarIntentoLogin({ prisma: estado.base.db, intento: { email, huella: HUELLA, ahora: AHORA }, verificar: async () => ({ ok: false, motivo: "password" }) }),
      ),
    );
    const bloqueo = await evaluarBloqueoDe(estado.base.db, "login", [await claveEmail(email)], AHORA);
    expect(bloqueo.bloqueado).toBe(true);
    const antes = await fallosDe(email);
    let verificado = false;
    const r = await procesarIntentoLogin({ prisma: estado.base.db, intento: { email, huella: HUELLA, ahora: AHORA }, verificar: async () => { verificado = true; return { ok: true, resultado: 1 }; } });
    expect(r.estado).toBe("rechazado");
    expect(verificado).toBe(false);
    expect(await fallosDe(email)).toBe(antes);
  });

  it("los éxitos no se registran como intentos", async () => {
    const email = `${randomUUID()}@test.uy`;
    const r = await procesarIntentoLogin({ prisma: estado.base.db, intento: { email, huella: HUELLA, ahora: AHORA }, verificar: async () => ({ ok: true, resultado: "sesion" }) });
    expect(r).toEqual({ estado: "ok", resultado: "sesion" });
    expect(await estado.base.prisma.intentoAcceso.count()).toBe(0);
  });
});

describe("iniciarSesion", () => {
  const deps = { comparar: bcrypt.compare, hashear: bcrypt.hash, huella: HUELLA };

  it("con la contraseña buena crea la sesión (solo el hash del token) y el evento cuenta.entrada sin IP", async () => {
    const { user, org, password } = await cuenta();
    const r = await iniciarSesion({ prisma: estado.base.db, email: user.email.toUpperCase(), password, ...deps });
    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.resultado).toMatchObject({ userId: user.id, organizationId: org.id });

    const fila = await estado.base.prisma.sesionAcceso.findUniqueOrThrow({ where: { id: r.resultado.sesionId } });
    expect(fila.tokenHash).toBe(await hashTokenSesion(r.resultado.token));
    expect(fila.ip).toBe(HUELLA.ip);
    expect(fila.cerradaEn).toBeNull();
    expect(JSON.stringify(fila)).not.toContain(r.resultado.token);

    const viva = await buscarSesionViva(estado.base.db, r.resultado.token, new Date());
    expect(viva?.user).toMatchObject({ id: user.id, organizationId: org.id, rol: "titular" });

    const evento = await estado.base.prisma.eventoAuditoria.findFirstOrThrow({ where: { accion: "cuenta.entrada", actorId: user.id } });
    expect(JSON.stringify(evento.detalle)).not.toContain(HUELLA.ip);
    expect(evento.detalle).toMatchObject({ sesionId: r.resultado.sesionId });
  });

  it("contraseña mal o email inexistente: rechazado, sin sesión", async () => {
    const { user } = await cuenta();
    expect((await iniciarSesion({ prisma: estado.base.db, email: user.email, password: "otra cosa distinta", ...deps })).estado).toBe("rechazado");
    expect((await iniciarSesion({ prisma: estado.base.db, email: "nadie@test.uy", password: "otra cosa distinta", ...deps })).estado).toBe("rechazado");
    expect(await estado.base.prisma.sesionAcceso.count()).toBe(0);
    expect(await estado.base.prisma.intentoAcceso.count({ where: { tipo: "login" } })).toBeGreaterThan(0);
  });

  it("cerrar una sesión la mata; cerrar todas respeta la excepción", async () => {
    const { user, password } = await cuenta();
    const abrir = async () => {
      const r = await iniciarSesion({ prisma: estado.base.db, email: user.email, password, ...deps });
      if (r.estado !== "ok") throw new Error("no abrió");
      return r.resultado;
    };
    const [a, b, c] = [await abrir(), await abrir(), await abrir()];
    expect(await listarSesionesVivas(estado.base.db, user.id, new Date())).toHaveLength(3);

    expect(await cerrarSesion(estado.base.db, { id: a.sesionId, userId: user.id, motivo: "salida", ahora: new Date() })).toBe(true);
    expect(await buscarSesionViva(estado.base.db, a.token, new Date())).toBeNull();
    expect(await cerrarSesion(estado.base.db, { id: a.sesionId, userId: user.id, motivo: "salida", ahora: new Date() })).toBe(false);

    expect(await cerrarTodas(estado.base.db, { userId: user.id, motivo: "salida_todas", ahora: new Date(), exceptoId: c.sesionId })).toBe(1);
    expect(await buscarSesionViva(estado.base.db, b.token, new Date())).toBeNull();
    expect(await buscarSesionViva(estado.base.db, c.token, new Date())).not.toBeNull();
    const cerrada = await estado.base.prisma.sesionAcceso.findUniqueOrThrow({ where: { id: b.sesionId } });
    expect(cerrada.motivoCierre).toBe("salida_todas");
  });
});

// Las dos carreras entre un login en vuelo y un cambio de contraseña. Sin el
// lock por usuaria del login, un atacante con la contraseña comprometida podía
// terminar de entrar DESPUÉS de que la víctima la cambiara.
describe("login y cambio de contraseña se excluyen", () => {
  const OPCIONES_LENTAS = { maxWait: 5_000, timeout: 20_000 };
  const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  it("un cambio commiteado mientras el login esperaba el lock por usuaria: rechazado, sin sesión", async () => {
    const { user, password } = await cuenta();
    const hashNuevo = await bcrypt.hash("otra contraseña larga", BCRYPT_RONDAS);
    let lockTomado!: () => void;
    const conLock = new Promise<void>((r) => { lockTomado = r; });
    let soltar!: () => void;
    const esperando = new Promise<void>((r) => { soltar = r; });
    // El cambio toma el lock primero y se queda con él hasta que el login
    // esté esperando detrás.
    const cambio = estado.base.db.$transaction(async (tx) => {
      await tomarLocks(tx, [claveUsuario(user.id)]);
      lockTomado();
      await esperando;
      await tx.user.update({ where: { id: user.id }, data: { hashedPassword: hashNuevo } });
    }, OPCIONES_LENTAS);
    await conLock;

    const login = iniciarSesion({
      prisma: estado.base.db, email: user.email, password, huella: HUELLA, comparar: bcrypt.compare, hashear: bcrypt.hash,
    });
    await dormir(300);
    soltar();
    await cambio;

    expect(await login).toEqual({ estado: "rechazado" });
    expect(await estado.base.prisma.sesionAcceso.count({ where: { userId: user.id } })).toBe(0);
  });

  it("un login que ya tiene el lock termina primero, y el cambio que esperaba cierra la sesión que creó", async () => {
    const { user, password } = await cuenta();
    const hashNuevo = await bcrypt.hash("otra contraseña larga", BCRYPT_RONDAS);
    let enCompare!: () => void;
    const comparando = new Promise<void>((r) => { enCompare = r; });
    let seguir!: () => void;
    const continuar = new Promise<void>((r) => { seguir = r; });

    const login = iniciarSesion({
      prisma: estado.base.db, email: user.email, password, huella: HUELLA, hashear: bcrypt.hash,
      // El compare corre con el lock por usuaria ya tomado: acá se frena el login.
      comparar: async (p, h) => { enCompare(); await continuar; return bcrypt.compare(p, h); },
    });
    await comparando;

    const cambio = estado.base.db.$transaction(async (tx) => {
      await tomarLocks(tx, [claveUsuario(user.id)]);
      await tx.user.update({ where: { id: user.id }, data: { hashedPassword: hashNuevo } });
      return cerrarTodas(tx, { userId: user.id, motivo: "cambio_password", ahora: new Date() });
    }, OPCIONES_LENTAS);
    // Mientras el login no suelte, el cambio no avanza.
    expect(await Promise.race([cambio.then(() => "avanzó"), dormir(300).then(() => "espera")])).toBe("espera");
    seguir();

    const resultado = await login;
    expect(resultado.estado).toBe("ok");
    expect(await cambio).toBe(1);
    if (resultado.estado === "ok") {
      expect(await buscarSesionViva(estado.base.db, resultado.resultado.token, new Date())).toBeNull();
    }
  });
});

describe("POST /api/cuenta/entrar", () => {
  it("200 con la cookie HttpOnly cuyo token abre la sesión; 401 genérico si no", async () => {
    const { user, password } = await cuenta();
    const { POST } = await import("@/app/api/cuenta/entrar/route");
    const ok = await POST(new Request("http://localhost/api/cuenta/entrar", {
      method: "POST", headers: { "x-forwarded-for": HUELLA.ip, "user-agent": "vitest" },
      body: JSON.stringify({ email: user.email, password }),
    }));
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const token = tokenDeCookieHeader(setCookie.split(";")[0], nombreCookie());
    expect(token).not.toBeNull();
    expect(await buscarSesionViva(estado.base.db, token!, new Date())).not.toBeNull();

    const mal = await POST(new Request("http://localhost/api/cuenta/entrar", {
      method: "POST", body: JSON.stringify({ email: user.email, password: "otra cosa distinta" }),
    }));
    expect(mal.status).toBe(401);
    expect(mal.headers.get("set-cookie")).toBeNull();
    const inexistente = await POST(new Request("http://localhost/api/cuenta/entrar", {
      method: "POST", body: JSON.stringify({ email: "nadie@test.uy", password: "otra cosa distinta" }),
    }));
    expect(inexistente.status).toBe(401);
    expect(await inexistente.text()).toBe(await mal.text());
  });
});
