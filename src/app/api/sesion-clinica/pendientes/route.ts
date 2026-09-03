// Endpoint M2M: lo consume el worker Python (processor/). Se autentica con
// PROCESSING_SECRET (Bearer token); está excluido del matcher de auth en
// src/middleware.ts.
//
// Entrega sesiones en "procesando" con un lease: cada entrega es un claim
// atómico (updateMany condicionado a estado + intentos) que incrementa
// `intentos`. Prisma mantiene updatedAt (@updatedAt) en cada claim, así que
// el lease se renueva solo al reclamar: una sesión reclamada no se vuelve a
// entregar hasta que pasen LEASE_MINUTES sin cambios. Superado
// MAX_INTENTOS_PROCESAMIENTO la sesión pasa a "error" (reintentable o
// descartable desde la UI) en vez de entregarse otra vez.

import { db } from "@/lib/db";

import { requireM2M } from "../../_lib/auth";
import { errorResponse } from "../../_lib/responses";
import { extraerCriptoTemporal } from "../../_lib/sesion-clinica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 5;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LEASE_MINUTES = envNumber("LEASE_MINUTES", 45);
const MAX_INTENTOS = envNumber("MAX_INTENTOS_PROCESAMIENTO", 3);

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const leaseVencidoAntesDe = new Date(Date.now() - LEASE_MINUTES * 60000);

    // Candidatas: nunca reclamadas (intentos 0) o con lease vencido.
    const candidatas = await db.sesionClinica.findMany({
      where: {
        estado: "procesando",
        OR: [{ intentos: 0 }, { updatedAt: { lt: leaseVencidoAntesDe } }],
      },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        turnoId: true,
        organizationId: true,
        audioR2Key: true,
        duracionAudioSeg: true,
        datosEstructurados: true,
        createdAt: true,
        intentos: true,
        turno: {
          select: {
            paciente: { select: { id: true } },
          },
        },
      },
    });

    // La orientación teórica vive en la Configuracion (singleton por
    // organización). Una sola query por las orgs presentes en el batch;
    // default "cbt_mi" si la org aún no tiene configuración.
    const orgIds = [...new Set(candidatas.map((s) => s.organizationId))];
    const configuraciones = orgIds.length
      ? await db.configuracion.findMany({
          where: { organizationId: { in: orgIds } },
          select: { organizationId: true, orientacionTeorica: true },
        })
      : [];
    const orientacionPorOrg = new Map(
      configuraciones.map((c) => [c.organizationId, c.orientacionTeorica]),
    );

    const payload: Array<{
      sesionClinicaId: string;
      turnoId: string;
      audioR2Key: string | null;
      duracionAudioSeg: number | null;
      pacienteId: string;
      claveCifrado: string | null;
      iv: string | null;
      createdAt: string;
      orientacionTeorica: string;
      intento: number;
    }> = [];

    for (const s of candidatas) {
      if (s.intentos >= MAX_INTENTOS) {
        // Tope alcanzado: a error, condicionado a que nadie la haya tocado
        // entre el findMany y acá (mismo estado + mismos intentos).
        await db.sesionClinica.updateMany({
          where: { id: s.id, estado: "procesando", intentos: s.intentos },
          data: {
            estado: "error",
            error: `Se agotaron los reintentos de procesamiento (${MAX_INTENTOS}). Reintentá o descartá la sesión.`,
          },
        });
        continue;
      }

      // Claim atómico: si otro worker la reclamó primero, intentos ya no
      // coincide y count es 0 → se omite.
      const { count } = await db.sesionClinica.updateMany({
        where: { id: s.id, estado: "procesando", intentos: s.intentos },
        data: { intentos: { increment: 1 } },
      });
      if (count === 0) continue;

      const { claveCifrado, iv } = extraerCriptoTemporal(s.datosEstructurados);
      payload.push({
        sesionClinicaId: s.id,
        turnoId: s.turnoId,
        audioR2Key: s.audioR2Key,
        duracionAudioSeg: s.duracionAudioSeg,
        pacienteId: s.turno.paciente.id,
        claveCifrado,
        iv,
        createdAt: s.createdAt.toISOString(),
        orientacionTeorica: orientacionPorOrg.get(s.organizationId) ?? "cbt_mi",
        intento: s.intentos + 1,
      });
    }

    return Response.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
