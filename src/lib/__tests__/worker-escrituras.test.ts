/**
 * Integración — todo lo que el worker escribe sobre una sesión lleva el
 * intento vigente y el ticket del reclamo: lease, ASR, checkpoint y
 * resultado. Y las vueltas a procesando de la usuaria (reprocesar,
 * reintentar) más eliminar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eliminarSesion } from "@/app/api/_lib/casos-uso/sesion/eliminar";
import { reclamarSesiones } from "@/app/api/_lib/casos-uso/sesion/reclamar";
import { registrarAsr } from "@/app/api/_lib/casos-uso/sesion/registrar-asr";
import { registrarTranscripcion } from "@/app/api/_lib/casos-uso/sesion/registrar-transcripcion";
import { reintentarSesion } from "@/app/api/_lib/casos-uso/sesion/reintentar";
import { renovarLease } from "@/app/api/_lib/casos-uso/sesion/renovar-lease";
import { reprocesarSesion } from "@/app/api/_lib/casos-uso/sesion/reprocesar";
import { aplicarResultadoSesion } from "@/app/api/_lib/casos-uso/sesion/resultado";
import { ApiError } from "@/app/api/_lib/responses";
import { autorizarTicketSesion } from "@/app/api/_lib/tickets";
import { LEASE_SESION_MS } from "@/lib/sesion-clinica/estados";

import {
  eventosAuditoriaDe,
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
const AHORA = new Date("2026-09-14T12:00:00Z");

beforeAll(async () => {
  base = conectarArea2();
  org = await crearOrg(base.prisma);
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

/** Crea una sesión en procesando y la reclama: devuelve intento y ticket. */
async function reclamada(extra: Partial<Parameters<typeof crearSesion>[2]> = {}, ahora = AHORA) {
  const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando", ...extra });
  const [s] = (
    await reclamarSesiones({ prisma: base.db, ahora, limite: 10, terminosAsr: async () => [] })
  ).filter((x) => x.sesionClinicaId === sesionId);
  return { sesionId, intento: s.intento, ticket: s.ticket };
}

const comun = (sesionId: string) => ({
  prisma: base.db,
  sesionId,
  organizationId: org.orgId,
});

function checkpoint(sesionId: string, intento: number) {
  return registrarTranscripcion({
    ...comun(sesionId),
    intento,
    transcripcion: TRANSCRIPCION,
    modeloAsr: "assemblyai:universal-2",
    speechAnalytics: {
      ratioHablaTerapeuta: 0.4,
      ratioHablaPaciente: 0.6,
      cantidadSilencios: 2,
      duracionPromedioSilenciosSeg: 3,
      tiempoTotalHablaSeg: 100,
    },
  });
}

function nota(sesionId: string, intento: number, plan = "P") {
  return aplicarResultadoSesion({
    ...comun(sesionId),
    resultado: {
      intento,
      resultado: "nota",
      nota: { ...NOTA, plan },
      datos: { temas: ["x"] },
      modeloLlm: "anthropic:claude-sonnet-5",
      promptVersion: "clinical_note_v4.md",
      uso: { asrSegundos: 120, llamadas: [{ nombre: "nota", entrada: 10, salida: 5 }] },
    },
  });
}

describe("ticket", () => {
  it("autoriza sólo el ticket del reclamo vigente; el de un reclamo viejo vale 401", async () => {
    const primera = await reclamada();
    const autorizada = await autorizarTicketSesion(pedidoConTicket(primera.ticket), base.db, primera.sesionId);
    expect(autorizada).toEqual({ sesionId: primera.sesionId, organizationId: org.orgId, intento: 1 });

    // Vence el lease y otro worker reclama: el ticket viejo deja de valer.
    const [segunda] = (
      await reclamarSesiones({
        prisma: base.db,
        ahora: new Date(AHORA.getTime() + LEASE_SESION_MS + 1),
        limite: 10,
        terminosAsr: async () => [],
      })
    ).filter((x) => x.sesionClinicaId === primera.sesionId);
    expect(segunda.intento).toBe(2);
    await expect(codigo(autorizarTicketSesion(pedidoConTicket(primera.ticket), base.db, primera.sesionId))).resolves.toBe(401);
    await expect(codigo(autorizarTicketSesion(pedidoConTicket(null), base.db, primera.sesionId))).resolves.toBe(401);
    await expect(codigo(autorizarTicketSesion(pedidoConTicket(segunda.ticket), base.db, primera.sesionId))).resolves.toBe(200);
  });
});

describe("lease", () => {
  it("se renueva con el intento vigente y se rechaza con uno viejo", async () => {
    const { sesionId, intento } = await reclamada();
    const despues = new Date(AHORA.getTime() + 60_000);
    const { leaseVenceEn } = await renovarLease({ prisma: base.db, sesionId, organizationId: org.orgId, intento, ahora: despues });
    expect(leaseVenceEn.getTime()).toBe(despues.getTime() + LEASE_SESION_MS);
    expect((await filaDe(base.prisma, sesionId))?.leaseVenceEn).toEqual(leaseVenceEn);
    await expect(
      codigo(renovarLease({ prisma: base.db, sesionId, organizationId: org.orgId, intento: intento - 1 })),
    ).resolves.toBe(409);
  });
});

describe("ASR y checkpoint", () => {
  it("la duración que informa el ASR NO pisa la que midió el teléfono: queda aparte, en la auditoría", async () => {
    const r = await reclamada();
    const antes = await filaDe(base.prisma, r.sesionId);

    await registrarTranscripcion({
      ...comun(r.sesionId),
      intento: r.intento,
      transcripcion: TRANSCRIPCION,
      modeloAsr: "assemblyai:universal-2",
      // El caso del 18/9: el teléfono dijo 1493 s y AssemblyAI encontró 982.
      duracionSeg: 982,
    });

    const despues = await filaDe(base.prisma, r.sesionId);
    expect(antes?.duracionAudioSeg).toBe(120);
    expect(despues?.duracionAudioSeg).toBe(120);
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, r.sesionId);
    expect(eventos[0]).toMatchObject({ accion: "sesion.transcripcion_guardada", detalle: { duracionAsrSeg: 982 } });
  });

  it("registrar el transcript deja UN trabajo de borrado aunque se registre dos veces", async () => {
    const { sesionId, intento } = await reclamada();
    const a = await registrarAsr({ ...comun(sesionId), intento, transcriptId: "tr-1" });
    const b = await registrarAsr({ ...comun(sesionId), intento, transcriptId: "tr-1" });
    expect(a.trabajoId).toBe(b.trabajoId);
    const trabajos = await trabajosDe(base.prisma, sesionId);
    expect(trabajos.map((t) => [t.tipo, t.ejecutor, t.payload])).toEqual([
      ["borrar_transcript_asr", "worker", { transcriptId: "tr-1" }],
    ]);
    expect((await filaDe(base.prisma, sesionId))?.asrTranscriptId).toBe("tr-1");
    await expect(codigo(registrarAsr({ ...comun(sesionId), intento: intento + 5, transcriptId: "tr-2" }))).resolves.toBe(409);
  });

  it("la transcripción se guarda apenas existe y con un intento viejo se rechaza", async () => {
    const { sesionId, intento } = await reclamada();
    await checkpoint(sesionId, intento);
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe("procesando");
    expect(fila?.modeloAsr).toBe("assemblyai:universal-2");
    expect(fila?.speechAnalytics).toMatchObject({ ratioHablaTerapeuta: 0.4 });
    expect((await camposDe(base.db, sesionId)).transcripcion).toBe(TRANSCRIPCION);
    // Idempotente.
    await checkpoint(sesionId, intento);
    await expect(codigo(checkpoint(sesionId, intento + 1))).resolves.toBe(409);
  });

  it("la nota no se acepta sin checkpoint previo", async () => {
    const { sesionId, intento } = await reclamada();
    await expect(codigo(nota(sesionId, intento))).resolves.toBe(409);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("procesando");
  });
});

describe("resultado", () => {
  it("un resultado de un intento viejo recibe 409 y no escribe (M6)", async () => {
    const { sesionId, intento } = await reclamada();
    await checkpoint(sesionId, intento);
    const [segunda] = (
      await reclamarSesiones({
        prisma: base.db,
        ahora: new Date(AHORA.getTime() + LEASE_SESION_MS + 1),
        limite: 10,
        terminosAsr: async () => [],
      })
    ).filter((x) => x.sesionClinicaId === sesionId);
    expect(segunda.intento).toBe(2);
    expect(segunda.checkpoint?.transcripcion).toBe(TRANSCRIPCION);

    await expect(codigo(nota(sesionId, 1))).resolves.toBe(409);
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe("procesando");
    expect(fila?.generacion).toBe(0);
    expect(await trabajosDe(base.prisma, sesionId)).toEqual([]);

    await nota(sesionId, 2);
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe("revision");
  });

  it("la nota pasa a revision, sube la generación, pide Para vos y suelta lease y ticket", async () => {
    const { sesionId, intento } = await reclamada();
    await checkpoint(sesionId, intento);
    await aplicarResultadoSesion({
      ...comun(sesionId),
      resultado: {
        intento,
        resultado: "nota",
        nota: NOTA,
        datos: { temas: ["x"], riesgoDetectado: { nivel: "bajo", indicadores: [], evidencia: [], notaParaTerapeuta: null } },
        modeloLlm: "anthropic:claude-sonnet-5",
        promptVersion: "clinical_note_v4.md",
      },
    });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila).toMatchObject({
      estado: "revision",
      generacion: 1,
      intento,
      feedbackEstado: "pendiente",
      leaseVenceEn: null,
      ticketHash: null,
      modeloLlm: "anthropic:claude-sonnet-5",
      promptVersion: "clinical_note_v4.md",
    });
    expect(fila?.procesadaEn).not.toBeNull();
    const campos = await camposDe(base.db, sesionId);
    expect(campos.notaIa).toEqual(NOTA);
    expect(campos.datos).toEqual({ temas: ["x"], riesgoDetectado: { nivel: "bajo", indicadores: [], evidencia: [], notaParaTerapeuta: null } });
    expect(campos.notaFinal).toBeNull();
    expect((await trabajosDe(base.prisma, sesionId)).map((t) => [t.tipo, t.payload])).toEqual([
      ["generar_feedback", { sesionId, pacienteId: org.pacienteId, generacion: 1 }],
    ]);
    // El checkpoint de arriba ya dejó el suyo: el del resultado es el último.
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, sesionId);
    expect(eventos.at(-1)).toMatchObject({
      accion: "sesion.resultado",
      actorTipo: "worker",
      detalle: { intento, resultado: "nota", estado: "revision", nivelRiesgo: "bajo" },
    });
    expect(JSON.stringify(eventos.at(-1)?.detalle)).not.toContain("temas");
  });

  it("un fallo transitorio deja la sesión en procesando con backoff; el reclamo siguiente la vuelve a entregar con intento + 1", async () => {
    const { sesionId, intento } = await reclamada();
    await aplicarResultadoSesion({
      ...comun(sesionId),
      ahora: AHORA,
      resultado: { intento, resultado: "fallo", codigo: "asr_timeout", definitivo: false, detalle: "AssemblyAI no respondió" },
    });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila).toMatchObject({
      estado: "procesando",
      fallosSeguidos: 1,
      falloCodigo: "asr_timeout",
      falloDetalle: "AssemblyAI no respondió",
      leaseVenceEn: null,
      ticketHash: null,
      intento,
    });
    expect(fila?.proximoIntentoEn?.getTime()).toBe(AHORA.getTime() + 60_000);

    const antes = await reclamarSesiones({ prisma: base.db, ahora: new Date(AHORA.getTime() + 30_000), limite: 10, terminosAsr: async () => [] });
    expect(antes.some((x) => x.sesionClinicaId === sesionId)).toBe(false);
    const despues = await reclamarSesiones({ prisma: base.db, ahora: new Date(AHORA.getTime() + 61_000), limite: 10, terminosAsr: async () => [] });
    expect(despues.find((x) => x.sesionClinicaId === sesionId)?.intento).toBe(intento + 1);
  });

  it("un fallo definitivo pasa a fallida con código y detalle", async () => {
    const { sesionId, intento } = await reclamada();
    const r = await aplicarResultadoSesion({
      ...comun(sesionId),
      resultado: { intento, resultado: "fallo", codigo: "descifrado_error", definitivo: true },
    });
    expect(r.estado).toBe("fallida");
    expect(await filaDe(base.prisma, sesionId)).toMatchObject({
      estado: "fallida",
      falloCodigo: "descifrado_error",
      ticketHash: null,
      leaseVenceEn: null,
    });
  });
});

describe("reprocesar (Volver a escribirla)", () => {
  it("vuelve a procesando sin borrar nada; el resultado siguiente reemplaza la nota IA y sube la generación (H-14)", async () => {
    const { sesionId, intento } = await reclamada();
    await checkpoint(sesionId, intento);
    await nota(sesionId, intento, "Plan 1");

    const r = await reprocesarSesion({ ...comun(sesionId), usuarioId: org.userId, ahora: AHORA });
    expect(r.estado).toBe("procesando");
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila).toMatchObject({ estado: "procesando", generacion: 1, fallosSeguidos: 0, intento, ticketHash: null });
    const campos = await camposDe(base.db, sesionId);
    expect(campos.notaIa?.plan).toBe("Plan 1");
    expect(campos.transcripcion).toBe(TRANSCRIPCION);

    const [segunda] = (
      await reclamarSesiones({ prisma: base.db, ahora: AHORA, limite: 10, terminosAsr: async () => [] })
    ).filter((x) => x.sesionClinicaId === sesionId);
    expect(segunda.intento).toBe(intento + 1);
    expect(segunda.checkpoint?.transcripcion).toBe(TRANSCRIPCION);
    expect(segunda.audio).toBeNull();

    await nota(sesionId, segunda.intento, "Plan 2");
    const fila2 = await filaDe(base.prisma, sesionId);
    expect(fila2?.generacion).toBe(2);
    expect((await camposDe(base.db, sesionId)).notaIa?.plan).toBe("Plan 2");
  });

  it("sin audio ni transcripción no se puede reprocesar (409)", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "revision", audio: false, notaIa: NOTA });
    await expect(codigo(reprocesarSesion({ ...comun(sesionId), usuarioId: org.userId }))).resolves.toBe(409);
  });
});

describe("reintentar y eliminar (desde fallida)", () => {
  it("reintentar limpia el fallo y los fallos seguidos pero no el intento", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "fallida",
      intento: 4,
      fallosSeguidos: 5,
      falloCodigo: "intentos_agotados",
    });
    const r = await reintentarSesion({ ...comun(sesionId), usuarioId: org.userId });
    expect(r.estado).toBe("procesando");
    expect(await filaDe(base.prisma, sesionId)).toMatchObject({
      estado: "procesando",
      intento: 4,
      fallosSeguidos: 0,
      falloCodigo: null,
      falloDetalle: null,
    });
  });

  it("eliminar sólo desde fallida: en revision responde 409", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "revision", notaIa: NOTA });
    await expect(codigo(eliminarSesion({ ...comun(sesionId), usuarioId: org.userId }))).resolves.toBe(409);
    expect(await filaDe(base.prisma, sesionId)).not.toBeNull();
  });

  it("eliminar borra la fila y deja el trabajo con prefijo e índice del archivo, en una transacción", async () => {
    const { sesionId, turnoId } = await crearSesion(base.prisma, org, { estado: "fallida", transcripcion: TRANSCRIPCION });
    const r = await eliminarSesion({ ...comun(sesionId), usuarioId: org.userId });
    expect(r).toEqual({ eliminada: true, audioPorBorrar: true });
    expect(await filaDe(base.prisma, sesionId)).toBeNull();
    // El turno queda libre para volver a grabar.
    expect(await base.prisma.turno.findUnique({ where: { id: turnoId } })).not.toBeNull();
    const [trabajo] = await trabajosDe(base.prisma, sesionId);
    expect(trabajo.tipo).toBe("borrar_audio_r2");
    expect(trabajo.payload).toEqual({ prefijo: `${org.orgId}/${sesionId}/`, indices: [0] });
    expect((await eventosAuditoriaDe(base.prisma, org.orgId, sesionId)).map((e) => e.accion)).toEqual(["sesion.eliminar"]);
  });

  it("eliminar sin audio no crea trabajo; de otra organización 404", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "fallida", audio: false });
    await expect(codigo(eliminarSesion({ ...comun(sesionId), organizationId: otra.orgId, usuarioId: otra.userId }))).resolves.toBe(404);
    expect(await filaDe(base.prisma, sesionId)).not.toBeNull();
    const r = await eliminarSesion({ ...comun(sesionId), usuarioId: org.userId });
    expect(r.audioPorBorrar).toBe(false);
    expect(await trabajosDe(base.prisma, sesionId)).toEqual([]);
  });
});
