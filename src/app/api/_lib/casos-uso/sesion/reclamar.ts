// Reclamo del worker: entregar sesiones en `procesando` con un lease corto y
// un ticket. Cada entrega es un claim atómico (`intento` leído en el WHERE):
// dos workers no pueden llevarse la misma sesión con el mismo número, y el
// número nunca se repite ni se resetea. Lo que se entrega:
//
//   - el ticket (credencial para lease, checkpoint, asr y resultado);
//   - el audio: la key calculada del archivo en R2 — sólo si todavía NO hay
//     transcripción;
//   - el checkpoint: la transcripción ya hecha (reproceso, reintento tras un
//     fallo del modelo): ningún intento vuelve a pagar el ASR;
//   - paciente, orientación teórica y vocabulario del ASR (best-effort).
//
// Una sesión con `fallosSeguidos >= MAX` no se entrega: pasa a `fallida`
// (código intentos_agotados). Es la única transición de actor "sistema".

import {
  CODIGO_INTENTOS_AGOTADOS,
  keyAudio,
  LEASE_SESION_MS,
  MAX_FALLOS_SEGUIDOS,
} from "@/lib/sesion-clinica/estados";
import type { SpeechAnalytics } from "@/lib/sesion-clinica/schema";

import { emitirTicket } from "../../tickets";

import type { ClienteSesion } from "./transicion";
import { transicionar } from "./transicion";

const ORIENTACION_DEFAULT = "cbt_mi";

/** Tope de sesiones por reclamo. */
export const LIMITE_RECLAMO_MAX = 5;

/**
 * Cuántas sesiones entrega un reclamo. Por defecto UNA: el worker las
 * procesa en serie y sólo renueva el lease de la que tiene entre manos; una
 * sesión reclamada que espera en su cola vencería y otro worker se la
 * llevaría. Un worker con capacidad real pide más con `?limite=`.
 */
export function limiteReclamo(valor: string | null | undefined): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, LIMITE_RECLAMO_MAX);
}

export interface AudioEntregado {
  organizationId: string;
  pausas: unknown;
  /** `<org>/<sesion>/0`: calculada, nunca persistida. El objeto es el audio
   *  tal como lo grabó el teléfono: no hay clave ni IV que entregar. */
  key: string;
}

export interface CheckpointEntregado {
  transcripcion: string;
  speechAnalytics: SpeechAnalytics | null;
  modeloAsr: string;
}

/** Lo que el worker recibe por cada sesión reclamada (contrato Área 4). */
export interface SesionReclamada {
  sesionClinicaId: string;
  intento: number;
  ticket: string;
  pacienteId: string;
  orientacionTeorica: string;
  terminosAsr: string[];
  duracionAudioSeg: number | null;
  /** null cuando ya hay checkpoint: no hace falta bajar el audio. */
  audio: AudioEntregado | null;
  /** null hasta que el worker registró la transcripción. */
  checkpoint: CheckpointEntregado | null;
}

export interface ReclamarSesionesInput {
  prisma: ClienteSesion;
  ahora: Date;
  limite: number;
  /** Vocabulario del ASR; best-effort. */
  terminosAsr: (organizationId: string, pacienteId: string) => Promise<string[]>;
}

export async function reclamarSesiones({
  prisma,
  ahora,
  limite,
  terminosAsr,
}: ReclamarSesionesInput): Promise<SesionReclamada[]> {
  const candidatas = await prisma.sesionClinica.findMany({
    where: {
      estado: "procesando",
      AND: [
        { OR: [{ proximoIntentoEn: null }, { proximoIntentoEn: { lte: ahora } }] },
        { OR: [{ leaseVenceEn: null }, { leaseVenceEn: { lt: ahora } }] },
      ],
    },
    orderBy: { creadaEn: "asc" },
    take: limite,
    select: { id: true, organizationId: true, intento: true, fallosSeguidos: true },
  });

  const entregadas: SesionReclamada[] = [];

  for (const c of candidatas) {
    if (c.fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
      await agotar(prisma, c);
      continue;
    }

    const { ticket, ticketHash } = emitirTicket();
    // El claim reevalúa TODO el predicado con el lock de la fila, no sólo el
    // intento: entre el findMany y acá el worker anterior pudo renovar el
    // lease (mismo intento) o pudo llegar un fallo transitorio que movió
    // proximoIntentoEn. En los dos casos, count = 0 y no se roba nada.
    const { count } = await prisma.sesionClinica.updateMany({
      where: {
        id: c.id,
        estado: "procesando",
        intento: c.intento,
        fallosSeguidos: c.fallosSeguidos,
        AND: [
          { OR: [{ proximoIntentoEn: null }, { proximoIntentoEn: { lte: ahora } }] },
          { OR: [{ leaseVenceEn: null }, { leaseVenceEn: { lt: ahora } }] },
        ],
      },
      data: {
        intento: { increment: 1 },
        leaseVenceEn: new Date(ahora.getTime() + LEASE_SESION_MS),
        ticketHash,
      },
    });
    if (count === 0) continue;

    const fila = await prisma.sesionClinica.findUniqueOrThrow({
      where: { id: c.id },
      select: {
        organizationId: true,
        duracionAudioSeg: true,
        pausas: true,
        modeloAsr: true,
        speechAnalytics: true,
        audioEstado: true,
        // Campo lógico: la extensión lo descifra al leer.
        transcripcion: true,
        turno: { select: { pacienteId: true } },
        organization: {
          select: { configuracion: { select: { orientacionTeorica: true } } },
        },
      },
    });
    const pacienteId = fila.turno.pacienteId;

    const checkpoint: CheckpointEntregado | null =
      fila.transcripcion && fila.modeloAsr
        ? {
            transcripcion: fila.transcripcion,
            speechAnalytics: (fila.speechAnalytics as SpeechAnalytics | null) ?? null,
            modeloAsr: fila.modeloAsr,
          }
        : null;

    const audio: AudioEntregado | null =
      !checkpoint && fila.audioEstado === "en_r2"
        ? {
            key: keyAudio(fila.organizationId, c.id, 0),
            organizationId: fila.organizationId,
            pausas: fila.pausas ?? [],
          }
        : null;

    entregadas.push({
      sesionClinicaId: c.id,
      intento: c.intento + 1,
      ticket,
      pacienteId,
      orientacionTeorica:
        fila.organization.configuracion?.orientacionTeorica ?? ORIENTACION_DEFAULT,
      terminosAsr: await terminosBestEffort(terminosAsr, fila.organizationId, pacienteId, c.id),
      duracionAudioSeg: fila.duracionAudioSeg,
      audio,
      checkpoint,
    });
  }

  return entregadas;
}

async function agotar(
  prisma: ClienteSesion,
  c: { id: string; organizationId: string; intento: number; fallosSeguidos: number },
): Promise<void> {
  try {
    await transicionar({
      prisma,
      operacion: "agotar",
      sesionId: c.id,
      organizationId: c.organizationId,
      condiciones: { intento: c.intento, fallosSeguidos: { gte: MAX_FALLOS_SEGUIDOS } },
      data: {
        falloCodigo: CODIGO_INTENTOS_AGOTADOS,
        falloDetalle: `Se agotaron los reintentos automáticos (${MAX_FALLOS_SEGUIDOS} fallos seguidos). Reintentá o eliminá la sesión.`,
        leaseVenceEn: null,
        ticketHash: null,
      },
    });
  } catch {
    // count = 0: alguien la tocó entre el findMany y acá. No es de nadie más
    // que del próximo poll.
  }
}

/** El vocabulario mejora la transcripción, no la habilita: si la consulta
 *  falla la sesión se entrega igual, sin términos. Sólo el id y el tipo de
 *  error al log: los términos son vocabulario clínico y nombres propios. */
async function terminosBestEffort(
  terminosAsr: ReclamarSesionesInput["terminosAsr"],
  organizationId: string,
  pacienteId: string,
  sesionId: string,
): Promise<string[]> {
  try {
    return await terminosAsr(organizationId, pacienteId);
  } catch (error) {
    console.warn("[reclamar] no se pudo leer el vocabulario; la sesión se entrega sin términos.", {
      sesionClinicaId: sesionId,
      tipoError: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }
}
