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
import type { db } from "@/lib/db";
import { cifrarTurno } from "@/lib/prisma-encryption";
import type { SerieCreada, Turno, TurnoCreado } from "@/types/domain";

import { toTurno } from "../domain";
import { ApiError } from "../responses";
import { programarEnvioDelTurno } from "./envios-del-turno";
import { fechasDeSerie } from "./serie-turnos";
import { buscarTurnoSolapado, tomarLockDeAgenda } from "./solapamiento-turnos";
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
  /** Momento del alta: decide si el turno lleva recordatorio. */
  ahora: Date;
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
  ahora,
}: CrearTurnoInput): Promise<TurnoCreado> {
  return prisma.$transaction(async (tx) => {
    // El lock PRIMERO y por toda la transacción: dos altas simultáneas para
    // el mismo hueco se ordenan y la segunda ve la primera (el porqué está
    // en solapamiento-turnos.ts).
    await tomarLockDeAgenda(tx, organizationId);

    const paciente = await tx.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { id: true, tarifa: true },
    });

    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
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
      const ocupado = await buscarTurnoSolapado({
        prisma: tx,
        organizationId,
        intervalo: { inicio: fechaTurno, duracionMin: duracion },
      });

      if (ocupado) {
        // El turno elegido choca: es el 409 de siempre, y aborta todo.
        if (primero === null) throw new ApiError(TURNO_SOLAPADO, 409);
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

    return {
      ...primero,
      serie:
        serieId === null || frecuencia === "unico"
          ? null
          : { id: serieId, frecuencia, creados, omitidas },
    };
  });
}
