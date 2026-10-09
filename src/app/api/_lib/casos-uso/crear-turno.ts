// Caso de uso: agendar un turno, suelto o como serie.
//
// Vivía dentro de POST /api/turnos. Acá la ruta solo valida el body y llama.
//
// Un turno "unico" es la alta de siempre. Con frecuencia semanal o quincenal
// se crea además una fila en series_turno y un turno por cada fecha de
// fechasDeSerie (serie-turnos.ts). Reglas:
//
//   - La regla de choques es la misma de siempre (assertSinSolapamiento),
//     aplicada a cada fecha por separado. Si el PRIMER turno choca, la
//     serie no se crea y sale el 409 de siempre. Si choca una repetición,
//     esa fecha se OMITE, el resto se genera igual, y las omitidas vuelven
//     en la respuesta para que la pantalla se las muestre a la profesional.
//   - Un turno que nace al grabar (`alGrabar`) no pasa por la regla: la
//     sesión ya está ocurriendo (decisión del dueño).
//   - Todo en una transacción y bajo el lock de agenda: o queda la serie
//     completa o no queda nada.
//   - Cada turno generado es independiente: mismos campos, mismo aviso por
//     SMS (programarEnvioDelTurno, casos-uso/envios-del-turno.ts), y se
//     mueve, cobra o cancela con los casos de uso de un turno suelto. Lo
//     único que los une es `serieId`, que solo lee "cancelar el resto".
//
// Las notas del turno van cifradas, atadas al id de la fila (por eso el id
// nace acá con crypto.randomUUID). La firma es la del anexo de
// docs/esquema.md: campo lógico `notas` de `turnos.notas_encrypted`, escrito
// con `cifrarTurno(id, { notas })` de @/lib/prisma-encryption (área 3).

import type {
  Duracion,
  FrecuenciaTurno,
  Modalidad,
} from "@/lib/constantes-turno";
import { ACCIONES } from "@/lib/auditoria-acciones";
import type { db } from "@/lib/db";
import { cifrarTurno } from "@/lib/prisma-encryption";
import type { SerieCreada, Turno, TurnoCreado } from "@/types/domain";

import { auditar } from "../auditoria";
import { motivoGrabacionNoAdmitida, toTurno } from "../domain";
import { requirePaciente } from "../pacientes";
import { ApiError } from "../responses";
import { programarEnvioDelTurno } from "./envios-del-turno";
import { fechasDeSerie } from "./serie-turnos";
import {
  buscarTurnoSolapado,
  rechazoPorSolapamiento,
  tomarLockDeAgenda,
} from "./solapamiento-turnos";
import { TURNO_SOLAPADO } from "@/lib/glosario";

type ClientePrisma = typeof db;

export interface CrearTurnoInput {
  prisma: ClientePrisma;
  organizationId: string;
  pacienteId: string;
  fecha: Date;
  duracion: Duracion;
  modalidad: Modalidad;
  notas: string | null;
  /** "unico" agenda un solo turno; lo demás crea una serie. */
  frecuencia: FrecuenciaTurno;
  /** El turno nace al grabar (la pantalla de grabar lo crea con la hora de
   *  este instante): la sesión ya está ocurriendo, así que no pasa por la
   *  regla de choques. Decisión del dueño. */
  alGrabar?: boolean;
  /** Con alGrabar: cuándo empezó la grabación. La fecha del turno tiene que
   *  caer en el plazo (motivoGrabacionNoAdmitida, domain.ts). */
  iniciadaEn?: Date;
  /** Momento del alta: decide si el turno lleva recordatorio. */
  ahora: Date;
  /** Quién agenda, para turno.crear. */
  usuarioId: string;
}

// La forma de la respuesta (TurnoCreado, SerieCreada) vive en
// src/types/domain.ts: la leen también las pantallas.
export type { SerieCreada, TurnoCreado };

export async function crearTurno({
  prisma,
  organizationId,
  pacienteId,
  fecha,
  duracion,
  modalidad,
  notas,
  frecuencia,
  alGrabar = false,
  iniciadaEn,
  ahora,
  usuarioId,
}: CrearTurnoInput): Promise<TurnoCreado> {
  if (alGrabar && iniciadaEn) {
    const motivo = motivoGrabacionNoAdmitida(fecha, iniciadaEn, ahora);
    if (motivo) throw new ApiError(motivo, 400);
  }
  return prisma.$transaction(async (tx) => {
    // El lock PRIMERO y por toda la transacción: dos altas simultáneas para
    // el mismo hueco se ordenan y la segunda ve la primera (el porqué está
    // en solapamiento-turnos.ts).
    await tomarLockDeAgenda(tx, organizationId);

    // La tarifa se lee con la fila compartida: un cambio de tarifa en curso
    // (actualizarPaciente, FOR NO KEY UPDATE) termina antes, y los turnos
    // nuevos nacen con la tarifa que quedó.
    await tx.$queryRaw`SELECT id FROM pacientes
      WHERE id = ${pacienteId} AND organization_id = ${organizationId} FOR SHARE`;
    const paciente = await requirePaciente(tx, pacienteId, organizationId, { id: true, tarifa: true });

    // El turno de una grabación sin turno es idempotente: su fecha es el
    // instante en que empezó a grabar (al milisegundo), así que un reintento
    // —la respuesta anterior se perdió, se cerró el navegador— encuentra el
    // que ya nació en vez de crear otro. Bajo el lock de agenda: dos intentos
    // a la vez se ordenan.
    if (alGrabar && iniciadaEn && iniciadaEn.getTime() === fecha.getTime()) {
      const existente = await tx.turno.findFirst({
        where: { organizationId, pacienteId: paciente.id, fecha, estado: { not: "cancelado" } },
      });
      if (existente) return { ...toTurno({ ...existente, notas: existente.notas ?? null }), serie: null };
    }

    const fechas =
      frecuencia === "unico" ? [fecha] : fechasDeSerie(fecha, frecuencia);

    const serieId =
      frecuencia === "unico"
        ? null
        : (
            await tx.serieTurno.create({
              data: {
                id: crypto.randomUUID(),
                organizationId,
                pacienteId: paciente.id,
                frecuencia,
                horaAncla: fecha,
              },
              select: { id: true },
            })
          ).id;

    let primero: Turno | null = null;
    let creados = 0;
    const omitidas: Date[] = [];

    for (const fechaTurno of fechas) {
      const ocupado = alGrabar
        ? null
        : await buscarTurnoSolapado({
            prisma: tx,
            organizationId,
            intervalo: { inicio: fechaTurno, duracionMin: duracion },
          });

      if (ocupado) {
        // El turno elegido choca: es el 409 de siempre, y aborta todo.
        if (primero === null) {
          throw rechazoPorSolapamiento({
            organizationId,
            intervalo: { inicio: fechaTurno, duracionMin: duracion },
            ocupado,
          });
        }
        omitidas.push(fechaTurno);
        continue;
      }

      const id = crypto.randomUUID();
      const fila = await tx.turno.create({
        data: {
          pacienteId: paciente.id,
          organizationId,
          fecha: fechaTurno,
          duracion,
          modalidad,
          estado: "programado",
          tarifaCobrada: paciente.tarifa,
          pagoEstado: "pendiente",
          serieId,
          ...cifrarTurno(id, { notas }),
        },
      });
      creados += 1;

      // Un turno con fecha pasada no lleva aviso (el caso de /grabar/nuevo,
      // que crea el turno con la hora de este instante). La regla vive en
      // casos-uso/envios-del-turno.ts.
      await programarEnvioDelTurno(tx, {
        turnoId: fila.id,
        organizationId,
        pacienteId: paciente.id,
        fechaTurno,
        ahora,
      });

      // Las notas recién escritas: no hace falta descifrar lo que se acaba
      // de cifrar.
      if (primero === null) primero = toTurno({ ...fila, notas });
    }

    // `primero` siempre queda asignado: la primera fecha o crea el turno o
    // lanza el 409. El chequeo es para el tipo.
    if (primero === null) throw new ApiError(TURNO_SOLAPADO, 409);

    // Un evento por alta, aunque sea una serie: el primer turno y cuántos
    // nacieron con él. Sin notas (van cifradas y son de la paciente).
    await auditar(tx, {
      organizationId,
      actorTipo: "usuario",
      actorId: usuarioId,
      accion: ACCIONES.turno.crear,
      entidad: "turno",
      entidadId: primero.id,
      creadoEn: ahora,
      detalle: {
        pacienteId: paciente.id,
        serieId,
        creados,
        omitidos: omitidas.length,
        alGrabar,
      },
    });

    return {
      ...primero,
      serie:
        serieId === null || frecuencia === "unico"
          ? null
          : { id: serieId, frecuencia, creados, omitidas },
    };
  });
}
