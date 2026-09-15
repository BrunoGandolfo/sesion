import { randomUUID } from "node:crypto";

import type { db } from "@/lib/db";
import { contenidoHiloSchema, type ContenidoHilo, type VersionHilo } from "@/lib/hilo/contenido";
import { cifrarHiloVersion } from "@/lib/prisma-encryption";

import { ApiError } from "../../responses";

export type ClienteHilo = Pick<typeof db,
  "paciente" | "hilo" | "hiloVersion" | "trabajo" | "sesionClinica" | "turno" |
  "eventoAuditoria" | "$queryRaw" | "$executeRaw"
>;
export type BaseHilo = ClienteHilo & Pick<typeof db, "$transaction">;
export interface IdentidadHilo { pacienteId: string; organizationId: string }
export function filtroHilo({ pacienteId, organizationId }: IdentidadHilo) { return { pacienteId, organizationId }; }
export const CONFLICTO_HILO = "El Recorrido cambió mientras lo revisabas. Tu borrador sigue en esta pantalla; leé la versión actual antes de volver a guardar.";

export async function exigirPaciente(tx: Pick<ClienteHilo, "paciente">, identidad: IdentidadHilo) {
  const p = await tx.paciente.findFirst({ where: { id: identidad.pacienteId, organizationId: identidad.organizationId }, select: { id: true } });
  if (!p) throw new ApiError("Paciente no encontrado", 404);
}

/** Único orden de locks: hilo, después trabajo. Lo usan escritores y claims. */
export async function bloquearHilo(tx: ClienteHilo, identidad: IdentidadHilo) {
  await exigirPaciente(tx, identidad);
  await tx.$executeRaw`
    INSERT INTO hilos (paciente_id, organization_id, ultima_version, actualizado_en)
    VALUES (${identidad.pacienteId}, ${identidad.organizationId}, 0, NOW())
    ON CONFLICT (paciente_id) DO NOTHING`;
  await tx.$queryRaw`SELECT paciente_id FROM hilos WHERE paciente_id = ${identidad.pacienteId}
    AND organization_id = ${identidad.organizationId} FOR UPDATE`;
  return tx.hilo.findFirstOrThrow({
    where: filtroHilo(identidad),
    select: { pacienteId: true, vigenteId: true, ultimaVersion: true, vigente: { select: { version: true } } },
  });
}
export type HiloBloqueado = Awaited<ReturnType<typeof bloquearHilo>>;

export function exigirVersion(hilo: HiloBloqueado, esperada: number) {
  if ((hilo.vigente?.version ?? 0) !== esperada) throw new ApiError(CONFLICTO_HILO, 409);
}

export const resumenSelect = {
  id: true, version: true, basadaEnVersion: true, actor: true, estado: true,
  sesionOrigenId: true, creadaPorUserId: true, creadaEn: true, resueltaEn: true,
  resueltaPorUserId: true, propuestaOrigenId: true,
} as const;

export async function leerVersion(tx: Pick<ClienteHilo, "hiloVersion">, identidad: IdentidadHilo, version: number): Promise<VersionHilo> {
  const fila = await tx.hiloVersion.findFirst({ where: { ...filtroHilo(identidad), version }, select: { ...resumenSelect, contenido: true } });
  if (!fila) throw new ApiError("Versión no encontrada", 404);
  return {
    ...fila, creadaEn: fila.creadaEn.toISOString(), resueltaEn: fila.resueltaEn?.toISOString() ?? null,
    contenido: contenidoHiloSchema.parse(fila.contenido),
  };
}

export async function insertarVersion(tx: ClienteHilo, identidad: IdentidadHilo, hilo: HiloBloqueado, datos: {
  contenido: ContenidoHilo; actor: "profesional" | "ia";
  estado: "aplicada" | "propuesta" | "desactualizada";
  basadaEnVersion: number; usuarioId?: string; sesionOrigenId?: string | null;
  propuestaOrigenId?: string; promptVersion?: string; modeloLlm?: string; ahora: Date;
}) {
  const referencias = [...new Set([
    ...datos.contenido.intervencionesProbadas.flatMap(i => i.sesiones),
    ...datos.contenido.riesgosHistoricos.map(r => r.sesionId),
  ])];
  if (referencias.length && await tx.sesionClinica.count({ where: {
    id: { in: referencias }, organizationId: identidad.organizationId,
    estado: "aprobada", turno: { pacienteId: identidad.pacienteId },
  } }) !== referencias.length) throw new ApiError("Las referencias deben ser notas aprobadas de esta paciente", 400);
  const id = randomUUID();
  const version = hilo.ultimaVersion + 1;
  await tx.hiloVersion.create({ data: {
    ...filtroHilo(identidad), version, basadaEnVersion: datos.basadaEnVersion || null,
    actor: datos.actor, estado: datos.estado, creadaPorUserId: datos.usuarioId ?? null,
    sesionOrigenId: datos.sesionOrigenId ?? null, propuestaOrigenId: datos.propuestaOrigenId,
    promptVersion: datos.promptVersion, modeloLlm: datos.modeloLlm, creadaEn: datos.ahora,
    ...cifrarHiloVersion(id, { contenido: datos.contenido }),
  } });
  await tx.hilo.update({ where: { pacienteId: identidad.pacienteId }, data: { ultimaVersion: version, actualizadoEn: datos.ahora } });
  return { id, version };
}

export async function aplicarVigente(tx: ClienteHilo, identidad: IdentidadHilo, versionId: string, usuarioId: string, ahora: Date) {
  const anteriores = await tx.hiloVersion.findMany({ where: { ...filtroHilo(identidad), estado: "propuesta", id: { not: versionId } }, select: { version: true } });
  await tx.hiloVersion.updateMany({
    where: { ...filtroHilo(identidad), estado: "propuesta", id: { not: versionId } },
    data: { estado: "desactualizada", resueltaEn: ahora, resueltaPorUserId: usuarioId },
  });
  await tx.hilo.update({ where: { pacienteId: identidad.pacienteId }, data: { vigenteId: versionId, actualizadoEn: ahora } });
  for (const anterior of anteriores) await auditarHilo(tx, identidad, "hilo.desactualizar", anterior.version, usuarioId, ahora);
}

export async function auditarHilo(tx: ClienteHilo, identidad: IdentidadHilo, accion: string, version: number, usuarioId: string | null, ahora: Date, trabajoId?: string) {
  const origen = await tx.hiloVersion.findFirst({ where: { ...filtroHilo(identidad), version }, select: { basadaEnVersion: true, sesionOrigenId: true } });
  await tx.eventoAuditoria.create({ data: {
    organizationId: identidad.organizationId, actorTipo: usuarioId ? "usuario" : "worker",
    actorId: usuarioId, accion, entidad: "hilo", entidadId: identidad.pacienteId,
    detalle: { version, ...origen, ...(trabajoId ? { trabajoId } : {}) }, creadoEn: ahora,
  } });
}
