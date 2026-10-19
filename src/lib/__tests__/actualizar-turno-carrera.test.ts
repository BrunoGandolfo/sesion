// La carrera entre editar el estado de un turno y cobrarlo (rev-dominio B5).
//
// Cobrar no toma el lock de agenda: entre la relectura bajo el lock y la
// escritura del PATCH el turno pudo quedar cobrado. La escritura exige el pago
// leído; si no escribe, se relee para contestar lo que de verdad pasó. Una
// base real no deja meter el cobro justo en ese hueco, así que acá el cliente
// es falso y el cobro "ocurre" entre las dos lecturas.
import { describe, expect, it } from "vitest";

import { actualizarTurno } from "@/app/api/_lib/casos-uso/turnos";
import { ApiError } from "@/app/api/_lib/responses";
import { MENSAJE_TURNO_PAGADO } from "@/lib/glosario";

const FECHA = new Date("2026-10-05T13:00:00.000Z");

function fila(estado: string, pagoEstado: string) {
  return {
    id: "t-1",
    organizationId: "org-1",
    pacienteId: "pac-1",
    fecha: FECHA,
    duracion: 50,
    modalidad: "presencial",
    estado,
    pagoEstado,
    pagoMetodo: pagoEstado === "pagado" ? "efectivo" : null,
    pagoFecha: pagoEstado === "pagado" ? FECHA : null,
    tarifaCobrada: 2000,
    notas: null,
    serieId: null,
    creadoEn: FECHA,
    actualizadoEn: FECHA,
  };
}

/** Un cliente cuyo turno, después de la relectura bajo el lock, pasa a ser
 *  `despues` (o desaparece con null): la escritura condicionada no lo toca. */
function clienteConCarrera(antes: ReturnType<typeof fila>, despues: ReturnType<typeof fila> | null) {
  let lecturas = 0;
  const tx = {
    $executeRaw: async () => 0,
    turno: {
      findFirst: async () => (lecturas++ === 0 ? antes : despues),
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => {
        throw new Error("no debería releer después de una escritura que no escribió");
      },
    },
  };
  return { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as never;
}

const editar = (prisma: never, estado: "realizado" | "cancelado") =>
  actualizarTurno({ prisma, organizationId: "org-1", turnoId: "t-1", cambios: { estado }, ahora: FECHA, usuarioId: "u-1" });

describe("PATCH de estado mientras alguien cobra el turno", () => {
  it("lo cobraron y quedó en el estado pedido (realizado): devuelve el turno, no un 409", async () => {
    const turno = await editar(clienteConCarrera(fila("programado", "pendiente"), fila("realizado", "pagado")), "realizado");
    expect(turno).toMatchObject({ id: "t-1", estado: "realizado", pagoEstado: "pagado" });
  });

  it("lo cobraron y se pedía otro estado: 409 con el texto del cobro", async () => {
    const error = await editar(clienteConCarrera(fila("programado", "pendiente"), fila("realizado", "pagado")), "cancelado").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: MENSAJE_TURNO_PAGADO });
  });

  it("el turno desapareció en el medio: 404, no 'ya está cobrado'", async () => {
    const error = await editar(clienteConCarrera(fila("programado", "pendiente"), null), "cancelado").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404 });
  });
});
