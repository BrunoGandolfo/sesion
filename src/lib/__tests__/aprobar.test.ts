/**
 * Integración — aprobar la nota (revision → aprobada) contra la base de test.
 * Garantías: no toca R2; nota final y los dos trabajos quedan en UNA
 * transacción; concurrencia y fallo de la base no dejan nada a medias;
 * aprobada es terminal; y el servidor exige las mismas confirmaciones que la
 * pantalla (riesgo de cualquier nivel, cada flag activo, las menciones),
 * también a una llamada directa a POST /aprobar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { aprobarSesion } from "@/app/api/_lib/casos-uso/sesion/aprobar";
import { eliminarSesion } from "@/app/api/_lib/casos-uso/sesion/eliminar";
import { reintentarSesion } from "@/app/api/_lib/casos-uso/sesion/reintentar";
import { reprocesarSesion } from "@/app/api/_lib/casos-uso/sesion/reprocesar";
import type { ClienteTransaccional } from "@/app/api/_lib/casos-uso/sesion/transicion";
import { ApiError } from "@/app/api/_lib/responses";
import * as r2 from "@/lib/r2";

import {
  eventosAuditoriaDe,
  camposDe,
  conectarArea2,
  crearOrg,
  crearSesion,
  filaDe,
  limpiarOrg,
  NOTA,
  trabajosDe,
  TRANSCRIPCION,
  type BaseArea2,
  type Org,
} from "./estados-fixtures";

const actor = vi.hoisted(() => ({ organizationId: "", userId: "" }));
vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => actor.organizationId,
  getSessionActor: async () => ({
    organizationId: actor.organizationId,
    userId: actor.userId,
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

vi.mock("@/lib/r2", () => ({
  borrarAudio: vi.fn(),
  existeAudio: vi.fn(),
  r2Configurado: vi.fn(() => true),
}));

let base!: BaseArea2;
let org!: Org;
let otra!: Org;
let rutaAprobar!: typeof import("@/app/api/sesion-clinica/[id]/aprobar/route").POST;

beforeAll(async () => {
  base = conectarArea2();
  org = await crearOrg(base.prisma);
  otra = await crearOrg(base.prisma);
  actor.organizationId = org.orgId;
  actor.userId = org.userId;
  // La ruta ve el cliente de test por el cache global de src/lib/db.ts.
  (globalThis as unknown as { prisma: unknown }).prisma = base.db;
  rutaAprobar = (await import("@/app/api/sesion-clinica/[id]/aprobar/route")).POST;
});

/** POST /api/sesion-clinica/[id]/aprobar, como lo llamaría cualquiera. */
async function postAprobar(sesionId: string, cuerpo: Record<string, unknown>): Promise<Response> {
  return rutaAprobar(
    new Request(`http://localhost/api/sesion-clinica/${sesionId}/aprobar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ id: sesionId }) },
  );
}

const RIESGO = (nivel: string) => ({ nivel, indicadores: [], evidencia: [], notaParaTerapeuta: null });
const FLAGS = (activos: string[]) => ({
  ideacionSuicida: activos.includes("ideacionSuicida"),
  autolesion: activos.includes("autolesion"),
  violenciaTerceros: activos.includes("violenciaTerceros"),
  sintomasPsicoticos: activos.includes("sintomasPsicoticos"),
  crisisPanico: activos.includes("crisisPanico"),
  detalle: "",
});

afterAll(async () => {
  await limpiarOrg(base.prisma, org.orgId);
  await limpiarOrg(base.prisma, otra.orgId);
  await base.prisma.$disconnect();
});

function enRevision(extra: Partial<Parameters<typeof crearSesion>[2]> = {}) {
  return crearSesion(base.prisma, org, {
    estado: "revision",
    transcripcion: TRANSCRIPCION,
    notaIa: NOTA,
    datos: { temas: ["x"] },
    ...extra,
  });
}

async function codigo(promesa: Promise<unknown>): Promise<number> {
  try {
    await promesa;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

describe("aprobar", () => {
  it("guarda la nota final, destruye la clave y deja los dos trabajos, sin llamar a R2", async () => {
    const { sesionId } = await enRevision();

    const respuesta = await aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
      notasEdicion: "sin cambios",
    });

    expect(respuesta.estado).toBe("aprobada");
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe("aprobada");
    expect(fila?.aprobadaEn).not.toBeNull();
    // El audio sigue anotado como en R2 hasta que el trabajo lo borre.
    expect(fila?.audioEstado).toBe("en_r2");
    const campos = await camposDe(base.db, sesionId);
    expect(campos.notaFinal).toEqual(NOTA);
    expect(campos.notaIa).toEqual(NOTA);
    expect(campos.notasEdicion).toBe("sin cambios");
    expect(campos.transcripcion).toBe(TRANSCRIPCION);

    const trabajos = await trabajosDe(base.prisma, sesionId);
    expect(trabajos.map((t) => [t.tipo, t.ejecutor, t.estado])).toEqual([
      ["borrar_audio_r2", "app", "pendiente"],
      ["integrar_contexto", "worker", "pendiente"],
    ]);
    expect(trabajos[0].payload).toEqual({ prefijo: `${org.orgId}/${sesionId}/` });
    expect(trabajos[1].payload).toEqual({ sesionId, pacienteId: org.pacienteId });
    expect(trabajos[1].pacienteId).toBe(org.pacienteId);

    expect(r2.borrarAudio).not.toHaveBeenCalled();
    // El rastro se lee de la tabla: el caso de uso lo escribe con el mismo
    // cliente que el acto, no con una función inyectada.
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, sesionId);
    expect(eventos.map((e) => e.accion)).toEqual(["sesion.aprobar"]);
    expect(eventos[0].detalle).toMatchObject({ trabajos: ["borrar_audio_r2", "integrar_contexto"] });
    expect(JSON.stringify(eventos[0].detalle)).not.toContain("S");
  });

  it("la nota editada es la final; la de la IA no se toca", async () => {
    const { sesionId } = await enRevision();
    const editada = { ...NOTA, plan: "Plan editado" };
    await aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
      notaEditada: editada,
    });
    const campos = await camposDe(base.db, sesionId);
    expect(campos.notaFinal).toEqual(editada);
    expect(campos.notaIa).toEqual(NOTA);
  });

  it("sin audio no crea borrar_audio_r2 pero sí integrar_contexto", async () => {
    const { sesionId } = await enRevision({ audio: false });
    await aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
    });
    expect((await trabajosDe(base.prisma, sesionId)).map((t) => t.tipo)).toEqual(["integrar_contexto"]);
  });

  it("riesgo moderado sin confirmación: 400 y nada cambia", async () => {
    const { sesionId } = await enRevision({
      datos: { riesgoDetectado: { nivel: "moderado", indicadores: [], evidencia: [], notaParaTerapeuta: null } },
    });
    const sinConfirmar = aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
    });
    await expect(codigo(sinConfirmar)).resolves.toBe(400);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("revision");
    expect(await trabajosDe(base.prisma, sesionId)).toEqual([]);

    await aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
      confirmoRiesgo: true,
    });
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("aprobada");
  });

  it("riesgo BAJO también exige confirmación (D1): sin ella, 400 y nada cambia", async () => {
    const { sesionId } = await enRevision({ datos: { riesgoDetectado: RIESGO("bajo") } });
    const sin = aprobarSesion({ generacion: 1, prisma: base.db, sesionId, organizationId: org.orgId, usuarioId: org.userId });
    await expect(codigo(sin)).resolves.toBe(400);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("revision");
    await aprobarSesion({ generacion: 1, prisma: base.db, sesionId, organizationId: org.orgId, usuarioId: org.userId, confirmoRiesgo: true });
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("aprobada");
  });

  it("cada flag activo exige su propia confirmación; confirmar uno no alcanza para dos", async () => {
    const { sesionId } = await enRevision({ datos: { flagsRiesgo: FLAGS(["ideacionSuicida", "autolesion"]) } });
    const base1 = { generacion: 1, prisma: base.db, sesionId, organizationId: org.orgId, usuarioId: org.userId };
    await expect(codigo(aprobarSesion(base1))).resolves.toBe(400);
    const uno = aprobarSesion({ ...base1, confirmoFlags: ["ideacionSuicida"] });
    await expect(uno).rejects.toThrow(/Autolesión|autolesion/i);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("revision");
    await aprobarSesion({ ...base1, confirmoFlags: ["ideacionSuicida", "autolesion"] });
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("aprobada");
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, sesionId);
    expect(eventos.at(-1)?.detalle).toMatchObject({ flagsConfirmados: 2 });
  });

  it("una llamada directa a POST /aprobar sin confirmar riesgo bajo o un flag activo recibe 400", async () => {
    const conBajo = await enRevision({ datos: { riesgoDetectado: RIESGO("bajo") } });
    const conFlag = await enRevision({ datos: { flagsRiesgo: FLAGS(["crisisPanico"]) } });

    const r1 = await postAprobar(conBajo.sesionId, { generacion: 1 });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/nivel bajo/);
    const r2 = await postAprobar(conFlag.sesionId, { generacion: 1, confirmoRiesgo: true });
    expect(r2.status).toBe(400);
    expect((await filaDe(base.prisma, conFlag.sesionId))?.estado).toBe("revision");

    expect((await postAprobar(conBajo.sesionId, { generacion: 1, confirmoRiesgo: true })).status).toBe(200);
    expect((await postAprobar(conFlag.sesionId, { generacion: 1, confirmoFlags: ["crisisPanico"] })).status).toBe(200);
  });

  it("menciones léxicas con el modelo en ninguno exigen 'Leí las menciones'", async () => {
    const { sesionId } = await enRevision({
      datos: {
        riesgoDetectado: { nivel: "ninguno", indicadores: [], evidencia: [], notaParaTerapeuta: null },
        riesgoLexico: { version: "1", coincidencias: [{ termino: "x", timestamp: "00:10", quote: "…" }] },
      },
    });
    const sin = aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
    });
    await expect(codigo(sin)).resolves.toBe(400);
    await aprobarSesion({ generacion: 1,
      prisma: base.db,
      sesionId,
      organizationId: org.orgId,
      usuarioId: org.userId,
      confirmoMenciones: true,
    });
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, sesionId);
    expect(eventos.at(-1)?.detalle).toMatchObject({ confirmoMenciones: true, menciones: 1 });
  });

  it("aprobar y reprocesar a la vez: exactamente uno gana (M3)", async () => {
    const { sesionId } = await enRevision();
    const comun = { sesionId, organizationId: org.orgId, usuarioId: org.userId };
    const [a, r] = await Promise.all([
      codigo(aprobarSesion({ generacion: 1, prisma: base.db, ...comun })),
      codigo(reprocesarSesion({ prisma: base.db, ...comun })),
    ]);
    expect([a, r].sort()).toEqual([200, 409]);
    const fila = await filaDe(base.prisma, sesionId);
    const trabajos = await trabajosDe(base.prisma, sesionId);
    if (a === 200) {
      expect(fila?.estado).toBe("aprobada");
      expect(trabajos).toHaveLength(2);
    } else {
      expect(fila?.estado).toBe("procesando");
      expect(trabajos).toEqual([]);
    }
  });

  it("si la base falla a mitad de la transacción, no queda trabajo ni clave destruida", async () => {
    const { sesionId } = await enRevision();
    // Cliente que rompe la creación de trabajos DENTRO de la transacción.
    const roto = new Proxy(base.db, {
      get(objetivo, prop, receptor) {
        if (prop !== "$transaction") return Reflect.get(objetivo, prop, receptor);
        return (fn: (tx: unknown) => Promise<unknown>) =>
          objetivo.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, p, r) {
                  if (p !== "trabajo") return Reflect.get(t, p, r);
                  return new Proxy(t.trabajo, {
                    get(tr, pp, rr) {
                      if (pp === "create") return () => Promise.reject(new Error("la base se cayó"));
                      return Reflect.get(tr, pp, rr);
                    },
                  });
                },
              }),
            ),
          );
      },
    }) as ClienteTransaccional;

    await expect(
      aprobarSesion({ generacion: 1,
        prisma: roto,
        sesionId,
        organizationId: org.orgId,
        usuarioId: org.userId,
      }),
    ).rejects.toThrow("la base se cayó");

    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe("revision");
    expect(fila?.notaFinalEncrypted).toBeNull();
    expect(await trabajosDe(base.prisma, sesionId)).toEqual([]);
  });

  it("otra organización recibe 404 y no toca la fila", async () => {
    const { sesionId } = await enRevision();
    await expect(
      codigo(
        aprobarSesion({ generacion: 1,
          prisma: base.db,
          sesionId,
          organizationId: otra.orgId,
          usuarioId: otra.userId,
        }),
      ),
    ).resolves.toBe(404);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("revision");
  });

  it("aprobada es terminal: aprobar, reprocesar, reintentar y eliminar responden 409", async () => {
    const { sesionId } = await enRevision();
    const comun = { sesionId, organizationId: org.orgId, usuarioId: org.userId };
    await aprobarSesion({ generacion: 1, prisma: base.db, ...comun });

    await expect(codigo(aprobarSesion({ generacion: 1, prisma: base.db, ...comun }))).resolves.toBe(409);
    await expect(codigo(reprocesarSesion({ prisma: base.db, ...comun }))).resolves.toBe(409);
    await expect(codigo(reintentarSesion({ prisma: base.db, ...comun }))).resolves.toBe(409);
    await expect(codigo(eliminarSesion({ prisma: base.db, ...comun }))).resolves.toBe(409);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("aprobada");
    expect(await trabajosDe(base.prisma, sesionId)).toHaveLength(2);
  });
});
