/**
 * Integración — "Para vos" con estado propio, el modelo de trabajo durable
 * (claim atómico, backoff, tope, borrado en R2 verificado) y la lectura de
 * la transcripción con auditoría.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reintentarFeedback } from "@/app/api/_lib/casos-uso/sesion/reintentar-feedback";
import { verTranscripcion } from "@/app/api/_lib/casos-uso/sesion/ver-transcripcion";
import { correrTrabajosApp } from "@/app/api/_lib/casos-uso/trabajos/correr-app";
import { crearTrabajo } from "@/app/api/_lib/casos-uso/trabajos/crear";
import { AudioNoBorradoError, ejecutarBorradoR2, PlazoAgotadoError } from "@/app/api/_lib/casos-uso/trabajos/ejecutar-borrado-r2";
import { entregarTrabajos } from "@/app/api/_lib/casos-uso/trabajos/entregar";
import { metricasTrabajos } from "@/app/api/_lib/casos-uso/trabajos/metricas";
import { POLITICA_POR_TIPO } from "@/app/api/_lib/casos-uso/trabajos/politica";
import { reclamarTrabajos } from "@/app/api/_lib/casos-uso/trabajos/reclamar";
import { resolverTrabajo } from "@/app/api/_lib/casos-uso/trabajos/resolver";
import { aplicarResultadoTrabajo } from "@/app/api/_lib/casos-uso/trabajos/resultado-worker";
import { ApiError } from "@/app/api/_lib/responses";
import { autorizarTicketTrabajo } from "@/app/api/_lib/tickets";

import {
  auditoriaEnMemoria,
  camposDe,
  conectarArea2,
  crearOrg,
  crearSesion,
  filaDe,
  limpiarOrg,
  NOTA,
  pedidoConTicket,
  trabajosDe,
  TRANSCRIPCION,
  type BaseArea2,
  type Org,
} from "./estados-fixtures";

let base!: BaseArea2;
let org!: Org;
let otra!: Org;
// Un minuto en el futuro: los trabajos nacen con proximo_intento_en = now()
// de la base, y el reclamo sólo entrega los que ya vencieron.
const AHORA = new Date(Date.now() + 60_000);

beforeAll(async () => {
  base = conectarArea2();
  org = await crearOrg(base.prisma, "cbt_mi");
  otra = await crearOrg(base.prisma);
});

afterAll(async () => {
  await limpiarOrg(base.prisma, org.orgId);
  await limpiarOrg(base.prisma, otra.orgId);
  await base.prisma.$disconnect();
});

async function codigo(promesa: Promise<unknown>): Promise<number> {
  try {
    await promesa;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

const comun = (sesionId: string) => ({
  prisma: base.db,
  sesionId,
  organizationId: org.orgId,
  usuarioId: org.userId,
  registrarAuditoria: auditoriaEnMemoria().registrar,
});

/** Entrega al worker el único trabajo pendiente de la sesión. */
async function entregado(sesionId: string, ahora = AHORA) {
  const lista = await entregarTrabajos({ prisma: base.db, ahora, limite: 50 });
  const mio = lista.find((x) => (x.payload as { sesionId?: string })?.sesionId === sesionId);
  if (!mio) throw new Error("no se entregó el trabajo");
  const autorizado = await autorizarTicketTrabajo(pedidoConTicket(mio.ticket), base.db, mio.trabajoId);
  return { ...mio, autorizado };
}

describe("Para vos", () => {
  it("se puede pedir de nuevo incluso aprobada: pasa a pendiente y nace el trabajo", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "aprobada",
      transcripcion: TRANSCRIPCION,
      notaIa: NOTA,
      feedbackEstado: "fallido",
    });
    const r = await reintentarFeedback(comun(sesionId));
    expect(r.estado).toBe("aprobada");
    expect(r.feedbackEstado).toBe("pendiente");
    expect((await trabajosDe(base.prisma, sesionId)).map((t) => [t.tipo, t.ejecutor])).toEqual([["generar_feedback", "worker"]]);
    // Ya pendiente: no se apila otro pedido.
    await expect(codigo(reintentarFeedback(comun(sesionId)))).resolves.toBe(409);
    expect(await trabajosDe(base.prisma, sesionId)).toHaveLength(1);
  });

  it("con Para vos listo, o sin transcripción, no hay nada que pedir (409)", async () => {
    const listo = await crearSesion(base.prisma, org, { estado: "revision", transcripcion: TRANSCRIPCION, feedbackEstado: "listo" });
    await expect(codigo(reintentarFeedback(comun(listo.sesionId)))).resolves.toBe(409);
    const sinTranscripcion = await crearSesion(base.prisma, org, { estado: "fallida", feedbackEstado: "no_pedido" });
    await expect(codigo(reintentarFeedback(comun(sinTranscripcion.sesionId)))).resolves.toBe(409);
  });

  it("el trabajo viaja con ticket y con la transcripción descifrada adjunta; el resultado escribe sólo el feedback", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "revision",
      transcripcion: TRANSCRIPCION,
      notaIa: NOTA,
      feedbackEstado: "no_pedido",
    });
    await base.prisma.sesionClinica.update({ where: { id: sesionId }, data: { speechAnalytics: { ratioHablaTerapeuta: 0.3 } } });
    await reintentarFeedback(comun(sesionId));

    const t = await entregado(sesionId);
    expect(t.tipo).toBe("generar_feedback");
    expect(t.intentos).toBe(1);
    expect(t.adjunto).toEqual({
      transcripcionFormateada: TRANSCRIPCION,
      speechAnalytics: { ratioHablaTerapeuta: 0.3 },
      orientacionTeorica: "cbt_mi",
    });
    const trabajoEnBase = await base.prisma.trabajo.findUniqueOrThrow({ where: { id: t.trabajoId } });
    expect(trabajoEnBase.estado).toBe("en_curso");
    expect(JSON.stringify(trabajoEnBase.payload)).not.toContain("hola");

    const resolucion = await aplicarResultadoTrabajo({
      prisma: base.db,
      trabajo: t.autorizado,
      resultado: { ok: true, feedback: { fortalezas: ["escucha"] }, promptVersion: "fb_v2", modeloLlm: "anthropic:x" },
    });
    expect(resolucion).toEqual({ estado: "hecho" });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.feedbackEstado).toBe("listo");
    expect(fila?.estado).toBe("revision");
    expect(await camposDe(base.db, sesionId)).toMatchObject({ feedback: { fortalezas: ["escucha"] }, notaIa: NOTA });
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: t.trabajoId } })).estado).toBe("hecho");
    // El ticket se anuló con el resultado.
    await expect(codigo(autorizarTicketTrabajo(pedidoConTicket(t.ticket), base.db, t.trabajoId))).resolves.toBe(401);
  });

  it("un fallo reintenta con backoff y al tope deja Para vos fallido con el error visible", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "aprobada",
      transcripcion: TRANSCRIPCION,
      notaIa: NOTA,
      feedbackEstado: "no_pedido",
    });
    await reintentarFeedback(comun(sesionId));
    const { tope, backoffMs } = POLITICA_POR_TIPO.generar_feedback;
    let ahora = AHORA;
    for (let i = 1; i <= tope; i += 1) {
      const t = await entregado(sesionId, ahora);
      expect(t.intentos).toBe(i);
      const r = await aplicarResultadoTrabajo({
        prisma: base.db,
        trabajo: t.autorizado,
        resultado: { ok: false, error: "llm_truncado: 8192 tokens" },
        ahora,
      });
      if (i < tope) {
        expect(r).toEqual({ estado: "pendiente", proximoIntentoEn: new Date(ahora.getTime() + backoffMs[Math.min(i, backoffMs.length) - 1]) });
        expect((await filaDe(base.prisma, sesionId))?.feedbackEstado).toBe("pendiente");
        ahora = new Date((r as { proximoIntentoEn: Date }).proximoIntentoEn.getTime() + 1);
      } else {
        expect(r).toEqual({ estado: "fallido" });
      }
    }
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.feedbackEstado).toBe("fallido");
    expect(fila?.feedbackError).toBe("llm_truncado: 8192 tokens");
    // Y se puede volver a pedir.
    await reintentarFeedback(comun(sesionId));
    expect((await filaDe(base.prisma, sesionId))?.feedbackEstado).toBe("pendiente");
  });

  it("un trabajo de feedback de la generación anterior no marca el feedback de la nueva", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "revision",
      transcripcion: TRANSCRIPCION,
      notaIa: NOTA,
      generacion: 1,
      feedbackEstado: "no_pedido",
    });
    await reintentarFeedback(comun(sesionId));
    const viejo = await entregado(sesionId);
    expect(viejo.autorizado.payload).toMatchObject({ generacion: 1 });

    // Volver a escribirla mientras el trabajo viejo sigue en curso: llega la
    // nota de la generación 2 y con ella otro pedido de feedback.
    await base.prisma.sesionClinica.update({
      where: { id: sesionId },
      data: { generacion: 2, feedbackEstado: "pendiente" },
    });
    await crearTrabajo({ prisma: base.db, tipo: "generar_feedback", payload: { sesionId, pacienteId: org.pacienteId, generacion: 2 }, organizationId: org.orgId, sesionId, pacienteId: org.pacienteId });

    const r = await aplicarResultadoTrabajo({ prisma: base.db, trabajo: viejo.autorizado, resultado: { ok: true, feedback: { viejo: true } } });
    expect(r).toEqual({ estado: "hecho" });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.feedbackEstado).toBe("pendiente");
    expect(fila?.feedbackEncrypted).toBeNull();

    const nuevo = await entregado(sesionId);
    expect(nuevo.autorizado.payload).toMatchObject({ generacion: 2 });
    await aplicarResultadoTrabajo({ prisma: base.db, trabajo: nuevo.autorizado, resultado: { ok: true, feedback: { nuevo: true } } });
    const fila2 = await filaDe(base.prisma, sesionId);
    expect(fila2?.feedbackEstado).toBe("listo");
    expect((await camposDe(base.db, sesionId)).feedback).toEqual({ nuevo: true });
  });

  it("integrar_contexto sin quien lo aplique responde 501 y el trabajo sigue reclamado", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "aprobada", notaIa: NOTA });
    await crearTrabajo({ prisma: base.db, tipo: "integrar_contexto", payload: { sesionId, pacienteId: org.pacienteId }, organizationId: org.orgId, sesionId, pacienteId: org.pacienteId });
    const lista = await entregarTrabajos({ prisma: base.db, ahora: AHORA, limite: 50, adjuntos: {} });
    const t = lista.find(x => (x.payload as { sesionId: string }).sesionId === sesionId)!;
    const trabajo = await autorizarTicketTrabajo(pedidoConTicket(t.ticket), base.db, t.trabajoId);
    await expect(codigo(aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: {} }, aplicadores: {} }))).resolves.toBe(501);
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: t.trabajoId } })).estado).toBe("en_curso");
  });
});

describe("trabajo durable", () => {
  it("dos consumidores a la vez: el claim se lleva cada trabajo una sola vez y el otro ejecutor no lo ve", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "fallida" });
    await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: `${org.orgId}/${sesionId}/`, indices: [0] }, organizationId: org.orgId, sesionId });
    const [a, b, w] = await Promise.all([
      reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 }),
      reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 }),
      reclamarTrabajos({ prisma: base.db, ejecutor: "worker", ahora: AHORA, limite: 50 }),
    ]);
    const mios = [...a, ...b].filter((t) => t.sesionId === sesionId);
    expect(mios).toHaveLength(1);
    expect(mios[0].intentos).toBe(1);
    expect(mios[0].ticket).toBeNull();
    expect(w.some((t) => t.sesionId === sesionId)).toBe(false);
    // Con lease vigente no se vuelve a reclamar.
    const otraVez = await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: new Date(AHORA.getTime() + 1000), limite: 50 });
    expect(otraVez.some((t) => t.sesionId === sesionId)).toBe(false);
  });

  it("borrar_audio_r2: hecho sólo cuando HeadObject dice 404; si el objeto sigue, reintenta con backoff", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "aprobada", notaIa: NOTA });
    await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: `${org.orgId}/${sesionId}/`, indices: [0, 1] }, organizationId: org.orgId, sesionId });
    const [trabajo] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 })).filter((t) => t.sesionId === sesionId);

    const borradas: string[] = [];
    const terco = { borrar: async (k: string) => { borradas.push(k); }, existe: async () => true };
    await expect(ejecutarBorradoR2({ prisma: base.db, r2: terco, trabajo, ahora: AHORA })).rejects.toBeInstanceOf(AudioNoBorradoError);
    expect(borradas).toEqual([`${org.orgId}/${sesionId}/0`, `${org.orgId}/${sesionId}/1`]);
    expect((await filaDe(base.prisma, sesionId))?.audioEstado).toBe("en_r2");
    const r = await resolverTrabajo({ prisma: base.db, trabajo, resultado: { ok: false, error: new AudioNoBorradoError("k") }, ahora: AHORA });
    expect(r).toEqual({ estado: "pendiente", proximoIntentoEn: new Date(AHORA.getTime() + 60_000) });
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: trabajo.id } })).ultimoError).toMatch(/AudioNoBorradoError/);

    const despues = new Date(AHORA.getTime() + 61_000);
    const [segundo] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: despues, limite: 50 })).filter((t) => t.sesionId === sesionId);
    expect(segundo.intentos).toBe(2);
    const obediente = { borrar: async () => {}, existe: async () => false };
    await ejecutarBorradoR2({ prisma: base.db, r2: obediente, trabajo: segundo, ahora: despues });
    await resolverTrabajo({ prisma: base.db, trabajo: segundo, resultado: { ok: true }, ahora: despues });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.audioEstado).toBe("borrado");
    expect(fila?.audioBorradoEn).toEqual(despues);
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: trabajo.id } })).estado).toBe("hecho");
  });

  it("el borrado se completa aunque la sesión ya no exista", async () => {
    const trabajo = await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: `${org.orgId}/inexistente/`, indices: [0] }, organizationId: org.orgId, sesionId: "inexistente" });
    const [reclamado] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 })).filter((t) => t.id === trabajo.id);
    const { keys } = await ejecutarBorradoR2({ prisma: base.db, r2: { borrar: async () => {}, existe: async () => false }, trabajo: reclamado, ahora: AHORA });
    expect(keys).toEqual([`${org.orgId}/inexistente/0`]);
    await resolverTrabajo({ prisma: base.db, trabajo: reclamado, resultado: { ok: true }, ahora: AHORA });
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: trabajo.id } })).estado).toBe("hecho");
  });

  it("un borrado largo se corta al vencer el plazo del trabajo, se reprograma y el reintento lo termina", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "aprobada", notaIa: NOTA });
    const indices = Array.from({ length: 40 }, (_, i) => i);
    await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: `${org.orgId}/${sesionId}/`, indices }, organizationId: org.orgId, sesionId, proximoIntentoEn: new Date(0) });
    const [trabajo] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 })).filter((t) => t.sesionId === sesionId);

    // Cada llamada a R2 "tarda" 1 s de reloj simulado: 80 llamadas no entran
    // en un plazo de 20 s, y el trabajo se corta entre tandas.
    let reloj = 0;
    const borradas = new Set<string>();
    const lento = {
      borrar: async (k: string) => { reloj += 1000; borradas.add(k); },
      existe: async (k: string) => { reloj += 1000; return !borradas.has(k); },
    };
    await expect(
      ejecutarBorradoR2({ prisma: base.db, r2: lento, trabajo, ahora: AHORA, plazoMs: 20_000, reloj: () => reloj }),
    ).rejects.toBeInstanceOf(PlazoAgotadoError);
    expect(borradas.size).toBeGreaterThan(0);
    expect(borradas.size).toBeLessThan(40);
    expect((await filaDe(base.prisma, sesionId))?.audioEstado).toBe("en_r2");

    const r = await resolverTrabajo({ prisma: base.db, trabajo, resultado: { ok: false, error: new PlazoAgotadoError(16, 80) }, ahora: AHORA });
    expect(r.estado).toBe("pendiente");

    // El reintento arranca de cero pero lo ya borrado no se repite en R2
    // (borrar es idempotente) y esta vez, con plazo, termina.
    const [segundo] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: new Date(AHORA.getTime() + 61_000), limite: 50 })).filter((t) => t.sesionId === sesionId);
    reloj = 0;
    await ejecutarBorradoR2({ prisma: base.db, r2: lento, trabajo: segundo, ahora: AHORA, plazoMs: 200_000, reloj: () => reloj });
    await resolverTrabajo({ prisma: base.db, trabajo: segundo, resultado: { ok: true }, ahora: AHORA });
    expect(borradas.size).toBe(40);
    expect((await filaDe(base.prisma, sesionId))?.audioEstado).toBe("borrado");
  });

  it("un resultado con intentos viejos no pisa un reclamo nuevo (409)", async () => {
    const trabajo = await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: "x/", indices: [] }, organizationId: org.orgId });
    const [primero] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: AHORA, limite: 50 })).filter((t) => t.id === trabajo.id);
    const [segundo] = (await reclamarTrabajos({ prisma: base.db, ejecutor: "app", ahora: new Date(AHORA.getTime() + 3 * 60_000), limite: 50 })).filter((t) => t.id === trabajo.id);
    expect(segundo.intentos).toBe(2);
    await expect(codigo(resolverTrabajo({ prisma: base.db, trabajo: primero, resultado: { ok: true }, ahora: AHORA }))).resolves.toBe(409);
    expect((await base.prisma.trabajo.findUniqueOrThrow({ where: { id: trabajo.id } })).estado).toBe("en_curso");
  });

  it("la corrida del cron toma de a un trabajo y para cuando se acaba el presupuesto, sin dejar reclamados", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "aprobada", notaIa: NOTA });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = await crearTrabajo({ prisma: base.db, tipo: "borrar_audio_r2", payload: { prefijo: `${org.orgId}/${sesionId}/`, indices: [i] }, organizationId: org.orgId, sesionId, proximoIntentoEn: new Date(0) });
      ids.push(t.id);
    }
    // Reloj simulado: cada trabajo "tarda" 20 s; presupuesto 50 s con
    // reserva de 15 s ⇒ entran dos, el tercero no se reclama.
    let reloj = AHORA.getTime();
    const ejecutados: string[] = [];
    const resumen = await correrTrabajosApp({
      prisma: base.db,
      presupuestoMs: 50_000,
      reservaPorTrabajoMs: 15_000,
      ahora: () => new Date(reloj),
      ejecutar: async (t) => {
        ejecutados.push(t.id);
        reloj += 20_000;
      },
    });
    expect(resumen).toMatchObject({ reclamados: 2, hechos: 2, agotoLaCola: false });
    const estados = await base.prisma.trabajo.findMany({ where: { id: { in: ids } }, select: { id: true, estado: true } });
    const porId = new Map(estados.map((t) => [t.id, t.estado]));
    expect(ejecutados.map((id) => porId.get(id))).toEqual(["hecho", "hecho"]);
    const noEjecutado = ids.find((id) => !ejecutados.includes(id))!;
    expect(porId.get(noEjecutado)).toBe("pendiente");

    // Con presupuesto de sobra, la cola se agota y lo dice.
    const segunda = await correrTrabajosApp({ prisma: base.db, presupuestoMs: 50_000, reservaPorTrabajoMs: 1_000, ahora: () => new Date(reloj), ejecutar: async () => {} });
    expect(segunda.agotoLaCola).toBe(true);
    expect(segunda.reclamados).toBeGreaterThanOrEqual(1);
  });

  it("las métricas cuentan fallidos y atrasados, nunca los hechos", async () => {
    const antes = await metricasTrabajos(base.db, AHORA);
    const viejo = new Date(AHORA.getTime() - 25 * 60 * 60 * 1000);
    const atrasado = await crearTrabajo({ prisma: base.db, tipo: "borrar_transcript_asr", payload: { transcriptId: "t" }, organizationId: org.orgId });
    await base.prisma.trabajo.update({ where: { id: atrasado.id }, data: { creadoEn: viejo } });
    const fallido = await crearTrabajo({ prisma: base.db, tipo: "borrar_transcript_asr", payload: { transcriptId: "t" }, organizationId: org.orgId });
    await base.prisma.trabajo.update({ where: { id: fallido.id }, data: { estado: "fallido", creadoEn: viejo } });
    const hecho = await crearTrabajo({ prisma: base.db, tipo: "borrar_transcript_asr", payload: { transcriptId: "t" }, organizationId: org.orgId });
    await base.prisma.trabajo.update({ where: { id: hecho.id }, data: { estado: "hecho", creadoEn: viejo } });
    const despues = await metricasTrabajos(base.db, AHORA);
    expect(despues.fallidos - antes.fallidos).toBe(1);
    expect(despues.atrasados - antes.atrasados).toBe(1);
  });
});

describe("ver transcripción", () => {
  it("la dueña la lee con evento propio; otra organización 404; sin transcripción 409", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "aprobada", transcripcion: TRANSCRIPCION, notaIa: NOTA });
    const auditoria = auditoriaEnMemoria();
    const r = await verTranscripcion({ ...comun(sesionId), registrarAuditoria: auditoria.registrar });
    expect(r).toEqual({ transcripcion: TRANSCRIPCION, hablanteTerapeuta: "S0" });
    expect(auditoria.eventos).toHaveLength(1);
    expect(auditoria.eventos[0]).toMatchObject({ accion: "sesion.ver_transcripcion", actorId: org.userId, entidadId: sesionId });
    expect(JSON.stringify(auditoria.eventos[0].detalle)).not.toContain("hola");

    await expect(codigo(verTranscripcion({ ...comun(sesionId), organizationId: otra.orgId, usuarioId: otra.userId }))).resolves.toBe(404);

    const sin = await crearSesion(base.prisma, org, { estado: "procesando" });
    await expect(codigo(verTranscripcion(comun(sin.sesionId)))).resolves.toBe(409);

    const fallidaConTexto = await crearSesion(base.prisma, org, { estado: "fallida", transcripcion: TRANSCRIPCION });
    await expect(verTranscripcion(comun(fallidaConTexto.sesionId))).resolves.toMatchObject({ transcripcion: TRANSCRIPCION });
  });
});
