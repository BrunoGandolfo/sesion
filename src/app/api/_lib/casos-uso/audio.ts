import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";
import { consentimientoVigenteDe } from "@/lib/consentimiento";
import { PRUEBA_TOPE } from "@/lib/glosario";
import { TOPE_GRABACIONES_PRUEBA } from "@/lib/limites-prueba";
import { cifrarSesion } from "@/lib/prisma-encryption";
import { keyAudio } from "@/lib/sesion-clinica/estados";
import type { DescriptorSegmento, EstadoAudioRemoto, PausaAudio } from "@/lib/audio/contrato";
import { ApiError } from "../responses";
import { SESION_SELECT, toSesionClinicaResponse } from "../sesion-clinica";
import { transicionar } from "./sesion/transicion";

type Base = { prisma: typeof db; organizationId: string };
type Sesion = Base & { sesionId: string };

export async function leerSesionPorTurno({ prisma, organizationId, turnoId }: Base & { turnoId: string }) {
  const fila = await prisma.sesionClinica.findFirst({ where: { turnoId, organizationId }, select: SESION_SELECT });
  return fila ? toSesionClinicaResponse(fila) : null;
}

export async function prepararAudio({ prisma, organizationId, turnoId }: Base & { turnoId: string }) {
  return prisma.$transaction(async (tx) => {
    // Serializa dos inicios del mismo turno sin reemplazar su identidad ni su clave.
    const tocado = await tx.turno.updateMany({ where: { id: turnoId, organizationId, estado: { in: ["programado", "realizado"] } }, data: { actualizadoEn: new Date() } });
    if (!tocado.count) throw new ApiError("El turno no está disponible para grabar", 409);
    const turno = await tx.turno.findUniqueOrThrow({ where: { id: turnoId }, select: { pacienteId: true } });
    if (!await consentimientoVigenteDe(tx, turno.pacienteId, organizationId)) throw new ApiError("Falta consentimiento vigente para grabar", 400);
    const existente = await tx.sesionClinica.findUnique({ where: { turnoId }, select: { id: true, estado: true, audioClave: true, segmentos: { select: { indice: true }, take: 1 } } });
    if (existente) {
      if (existente.estado !== "grabando") throw new ApiError("La grabación ya se cerró. Revisá su estado.", 409);
      if (!existente.audioClave) {
        if (existente.segmentos.length) throw new ApiError("Hay segmentos sin clave. Se conservan para revisión.", 409);
        await tx.sesionClinica.update({ where: { id: existente.id }, data: cifrarSesion(existente.id, { audioClave: randomBytes(32).toString("base64") }) });
      }
      return { id: existente.id };
    }
    // Una grabación nueva suma al contador del consultorio. En un consultorio
    // de prueba, sólo si no llegó al tope: el UPDATE toma el lock de la fila y
    // vuelve a mirar la condición, así dos inicios a la vez no pasan del tope.
    // Reanudar la misma grabación (arriba) no suma.
    const contada = await tx.organization.updateMany({
      where: { id: organizationId, OR: [{ deInvitacion: false }, { grabacionesIniciadas: { lt: TOPE_GRABACIONES_PRUEBA } }] },
      data: { grabacionesIniciadas: { increment: 1 } },
    });
    if (!contada.count) throw new ApiError(PRUEBA_TOPE, 403);
    const id = randomUUID();
    await tx.sesionClinica.create({ data: { ...cifrarSesion(id, { audioClave: randomBytes(32).toString("base64") }), organizationId, turnoId, estado: "grabando" } });
    return { id };
  });
}

export async function claveAudio({ prisma, organizationId, sesionId }: Sesion) {
  const fila = await prisma.sesionClinica.findFirst({ where: { id: sesionId, organizationId }, select: { estado: true, audioClave: true, turno: { select: { pacienteId: true } } } });
  if (!fila) throw new ApiError("Grabación no encontrada", 404);
  if (fila.estado !== "grabando" || !fila.audioClave) throw new ApiError("La grabación ya no admite captura", 409);
  if (!await consentimientoVigenteDe(prisma, fila.turno.pacienteId, organizationId)) throw new ApiError("Falta autorización vigente para grabar", 403);
  return { clave: fila.audioClave };
}

export async function estadoAudio({ prisma, organizationId, sesionId }: Sesion): Promise<EstadoAudioRemoto> {
  const fila = await prisma.sesionClinica.findFirst({ where: { id: sesionId, organizationId }, select: { id: true, estado: true, duracionAudioSeg: true, pausas: true, segmentos: { orderBy: { indice: "asc" }, select: { indice: true, iv: true, bytes: true, sha256: true, inicioMs: true, continuacion: true, confirmadoEn: true } } } });
  if (!fila) throw new ApiError("Grabación no encontrada", 404);
  return { ...fila, pausas: (fila.pausas ?? []) as unknown as PausaAudio[], segmentos: fila.segmentos.map(s => ({ indice: s.indice, iv: Buffer.from(s.iv).toString("base64"), bytes: s.bytes, sha256: s.sha256, inicioMs: s.inicioMs, continuacion: s.continuacion, confirmado: s.confirmadoEn !== null })) };
}

export type ObjetosAudio = {
  firmar: (key: string, descriptor: DescriptorSegmento) => Promise<{ url: string; headers: Record<string, string> }>;
  comprobar: (key: string) => Promise<{ existe: boolean; bytes: number | null; sha256?: string }>;
};

export async function reservarSegmento(input: Sesion & { descriptor: DescriptorSegmento; objetos: ObjetosAudio }) {
  const { prisma, organizationId, sesionId, descriptor: d } = input;
  if (d.indice === 0 && (d.inicioMs !== 0 || d.continuacion)) throw new ApiError("El primer segmento empieza en cero y no continúa a ninguno", 400);
  const confirmado = await prisma.$transaction(async tx => {
    // Mismo lock que el cierre: ningún segmento puede aparecer después de sellar.
    const lock = await tx.sesionClinica.updateMany({ where: { id: sesionId, organizationId, estado: "grabando" }, data: { actualizadaEn: new Date() } });
    if (!lock.count) throw new ApiError("La grabación ya se cerró o no está disponible", 409);
    const existente = await tx.audioSegmento.findUnique({ where: { sesionId_indice: { sesionId, indice: d.indice } } });
    if (existente) {
      if (existente.bytes !== d.bytes || existente.sha256 !== d.sha256 || existente.inicioMs !== d.inicioMs || existente.continuacion !== d.continuacion || Buffer.from(existente.iv).toString("base64") !== d.iv) throw new ApiError("Ese segmento ya tiene otro contenido o inicio. Se conserva la copia local.", 409);
      return existente.confirmadoEn !== null;
    }
    const cantidad = await tx.audioSegmento.count({ where: { sesionId, organizationId } });
    if (d.indice !== cantidad) throw new ApiError("Primero hay que subir los segmentos anteriores", 409);
    if (d.indice > 0) {
      const anterior = await tx.audioSegmento.findUniqueOrThrow({ where: { sesionId_indice: { sesionId, indice: d.indice - 1 } } });
      if (anterior.inicioMs === null || d.inicioMs <= anterior.inicioMs) throw new ApiError("Los inicios deben seguir el orden de captura", 409);
    }
    await tx.audioSegmento.create({ data: { ...d, iv: Buffer.from(d.iv, "base64"), sesionId, organizationId } });
    return false;
  });
  if (confirmado) return { confirmado: true as const };
  return { confirmado: false as const, ...await input.objetos.firmar(keyAudio(organizationId, sesionId, d.indice), d) };
}

export async function confirmarSegmento(input: Sesion & { indice: number; objetos: ObjetosAudio }) {
  const { prisma, organizationId, sesionId, indice } = input;
  const segmento = await prisma.audioSegmento.findFirst({ where: { sesionId, organizationId, indice } });
  if (!segmento) throw new ApiError("Segmento no encontrado", 404);
  if (segmento.confirmadoEn) return { confirmado: true };
  const objeto = await input.objetos.comprobar(keyAudio(organizationId, sesionId, indice));
  if (!objeto.existe) return { confirmado: false };
  if (objeto.bytes !== segmento.bytes || objeto.sha256 !== segmento.sha256) throw new ApiError("El segmento recibido no coincide. Se conserva la copia local.", 409);
  await prisma.$transaction(async tx => {
    const lock = await tx.sesionClinica.updateMany({ where: { id: sesionId, organizationId, estado: { in: ["grabando", "subiendo"] } }, data: { audioEstado: "en_r2" } });
    if (!lock.count) throw new ApiError("La sesión cambió. Volvé a consultar su estado.", 409);
    await tx.audioSegmento.updateMany({ where: { sesionId, organizationId, indice, sha256: segmento.sha256 }, data: { confirmadoEn: new Date() } });
  });
  return { confirmado: true };
}

export async function finalizarAudio(input: Sesion & { cantidad: number; duracionAudioSeg: number; pausas: PausaAudio[] }) {
  const { prisma, organizationId, sesionId, cantidad, duracionAudioSeg, pausas } = input;
  await prisma.$transaction(async tx => {
    // Bloqueo de fila antes de inspeccionar inventario o repetir el recibo.
    const lock = await tx.sesionClinica.updateMany({ where: { id: sesionId, organizationId }, data: { actualizadaEn: new Date() } });
    if (!lock.count) throw new ApiError("Grabación no encontrada", 404);
    const fila = await tx.sesionClinica.findUniqueOrThrow({ where: { id: sesionId }, select: { estado: true, turnoId: true, duracionAudioSeg: true, pausas: true, segmentos: { orderBy: { indice: "asc" } } } });
    if (fila.segmentos.length !== cantidad || fila.segmentos.some((s, i) => s.indice !== i || !s.confirmadoEn)) throw new ApiError("Todavía faltan segmentos por confirmar", 409);
    if (fila.segmentos.some(s => s.inicioMs === null)) throw new ApiError("Falta la medida de inicio de un segmento. Se conserva para revisar.", 409);
    if (fila.segmentos[0].inicioMs !== 0) throw new ApiError("El primer segmento empieza en cero", 409);
    if (fila.estado !== "grabando") {
      const previas = (fila.pausas ?? []) as unknown as PausaAudio[];
      const mismasPausas = previas.length === pausas.length && previas.every((p, i) => p.inicio === pausas[i].inicio && p.fin === pausas[i].fin && p.siguienteIndice === pausas[i].siguienteIndice && p.motivo === pausas[i].motivo);
      if (fila.duracionAudioSeg !== duracionAudioSeg || !mismasPausas) throw new ApiError("La sesión tiene otro cierre. Se conserva la copia local.", 409);
      return;
    }
    await transicionar({ prisma: tx, organizationId, sesionId, operacion: "empezar_subida", data: { duracionAudioSeg, pausas: pausas as unknown as Prisma.InputJsonArray } });
    await transicionar({ prisma: tx, organizationId, sesionId, operacion: "audio_listo", data: { audioEstado: "en_r2", proximoIntentoEn: new Date() } });
    await tx.turno.updateMany({ where: { id: fila.turnoId, organizationId, estado: "programado" }, data: { estado: "realizado" } });
    await tx.envioSms.updateMany({ where: { turnoId: fila.turnoId, organizationId, estado: "pendiente", motivo: "recordatorio_turno" }, data: { estado: "cancelado", motivoNoEnvio: "El turno ya se realizó" } });
  });
  return estadoAudio(input);
}
