// Caso de uso: entregar al worker las sesiones en "procesando" con un lease.
//
// Cada entrega es un claim atómico (updateMany condicionado a estado +
// intentos) que incrementa `intentos`. Prisma mantiene updatedAt (@updatedAt)
// en cada claim, así que el lease se renueva solo al reclamar: una sesión
// reclamada no se vuelve a entregar hasta que pasen `leaseMinutos` sin
// cambios. Superado `maxIntentos` la sesión pasa a "error" (reintentable o
// descartable desde la UI) en vez de entregarse otra vez.
//
// Sin request ni Response: recibe prisma y `ahora` como parámetros.

import type { db } from "@/lib/db";

import { extraerCriptoTemporal } from "../sesion-clinica";
import { terminosAsr } from "./terminos-asr";

type ClientePrisma = typeof db;

export interface ReclamarPendientesParams {
  prisma: ClientePrisma;
  ahora: Date;
  /** Máximo de sesiones a evaluar por llamada. */
  limite: number;
  /** Minutos sin cambios tras los cuales un claim se considera vencido. */
  leaseMinutos: number;
  /** Cantidad de claims tras la cual la sesión pasa a "error". */
  maxIntentos: number;
}

/** Lo que el worker Python lee de cada sesión reclamada. */
export interface SesionReclamada {
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
  /**
   * Vocabulario clínico que el ASR tiene que escuchar en esta sesión: lo
   * global y lo de la profesional, más lo propio de esta paciente. Ordenado
   * y sin repetidos; `[]` si la organización todavía no cargó ninguno, que
   * es el caso de una cuenta recién abierta.
   */
  terminosAsr: string[];
}

const ORIENTACION_DEFAULT = "cbt_mi";

export async function reclamarPendientes({
  prisma,
  ahora,
  limite,
  leaseMinutos,
  maxIntentos,
}: ReclamarPendientesParams): Promise<SesionReclamada[]> {
  const leaseVencidoAntesDe = new Date(ahora.getTime() - leaseMinutos * 60000);

  // Candidatas: nunca reclamadas (intentos 0) o con lease vencido.
  const candidatas = await prisma.sesionClinica.findMany({
    where: {
      estado: "procesando",
      OR: [{ intentos: 0 }, { updatedAt: { lt: leaseVencidoAntesDe } }],
    },
    orderBy: { createdAt: "asc" },
    take: limite,
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
    ? await prisma.configuracion.findMany({
        where: { organizationId: { in: orgIds } },
        select: { organizationId: true, orientacionTeorica: true },
      })
    : [];
  const orientacionPorOrg = new Map(
    configuraciones.map((c) => [c.organizationId, c.orientacionTeorica]),
  );

  const reclamadas: SesionReclamada[] = [];

  for (const s of candidatas) {
    if (s.intentos >= maxIntentos) {
      // Tope alcanzado: a error, condicionado a que nadie la haya tocado
      // entre el findMany y acá (mismo estado + mismos intentos).
      await prisma.sesionClinica.updateMany({
        where: { id: s.id, estado: "procesando", intentos: s.intentos },
        data: {
          estado: "error",
          error: `Se agotaron los reintentos de procesamiento (${maxIntentos}). Reintentá o descartá la sesión.`,
        },
      });
      continue;
    }

    // Claim atómico: si otro worker la reclamó primero, intentos ya no
    // coincide y count es 0 → se omite.
    const { count } = await prisma.sesionClinica.updateMany({
      where: { id: s.id, estado: "procesando", intentos: s.intentos },
      data: { intentos: { increment: 1 } },
    });
    if (count === 0) continue;

    const { claveCifrado, iv } = extraerCriptoTemporal(s.datosEstructurados);

    // Después del claim y no antes: solo se consulta el vocabulario de las
    // sesiones que efectivamente se entregan (a lo sumo `limite` por llamada).
    //
    // Y best-effort, como el contexto clínico del worker: el vocabulario
    // mejora la transcripción, no la habilita. Si esta consulta explota, la
    // sesión ya tiene el claim puesto —`intentos` incrementado, `updatedAt`
    // renovado—, así que dejar subir el error la deja reclamada y sin
    // entregar hasta que venza el lease, y en un lote se lleva puestas
    // también a las que ya estaban listas. Se entrega igual, sin términos.
    let terminos: string[] = [];
    try {
      terminos = await terminosAsr({
        prisma,
        organizationId: s.organizationId,
        pacienteId: s.turno.paciente.id,
      });
    } catch (error) {
      // El id y el tipo de error, nunca los términos: son vocabulario
      // clínico y nombres propios de la paciente, y esto va al log de la
      // función.
      console.warn(
        "[reclamar-pendientes] no se pudo leer el vocabulario; la sesión se entrega sin términos.",
        {
          sesionClinicaId: s.id,
          tipoError: error instanceof Error ? error.name : typeof error,
        },
      );
    }

    reclamadas.push({
      sesionClinicaId: s.id,
      turnoId: s.turnoId,
      audioR2Key: s.audioR2Key,
      duracionAudioSeg: s.duracionAudioSeg,
      pacienteId: s.turno.paciente.id,
      claveCifrado,
      iv,
      createdAt: s.createdAt.toISOString(),
      orientacionTeorica:
        orientacionPorOrg.get(s.organizationId) ?? ORIENTACION_DEFAULT,
      intento: s.intentos + 1,
      terminosAsr: terminos,
    });
  }

  return reclamadas;
}
