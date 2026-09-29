// Caso de uso: la lista completa de deudores de /api/deudores (Cobros, "Te
// deben").
//
// Vivía en la ruta, que además la ordenaba por días de atraso: Hoy ordenaba
// por monto y antigüedad, y la misma persona podía estar primera en una
// pantalla y última en la otra. Ahora el orden es el de calcularDeudores
// (domain.ts, lib/orden-deuda.ts), el mismo que usa Hoy por construcción:
// decisión del dueño, un solo orden, el de Hoy.
//
// Sin tope, a diferencia de Hoy (TOPE_DEUDORES). Sin request ni Response.

import type { db } from "@/lib/db";

import {
  buscarTurnosConDeuda,
  calcularDeudores,
  type DeudoresApiItem,
} from "../domain";
import { ultimoAvisoPorPaciente } from "./recordar-cobro";

type ClientePrisma = typeof db;

export interface ListarDeudoresInput {
  prisma: ClientePrisma;
  organizationId: string;
  ahora: Date;
}

/**
 * Todos los deudores de la organización, en el orden de la deuda (monto
 * descendente y, a igual monto, el impago más viejo primero), con lo que
 * Cobros necesita para el aviso: el teléfono al que sale el SMS, los minutos
 * impagos y cuándo se le avisó por última vez.
 */
export async function listarDeudores({
  prisma,
  organizationId,
  ahora,
}: ListarDeudoresInput): Promise<DeudoresApiItem[]> {
  const turnos = await buscarTurnosConDeuda(prisma, organizationId);
  const telefonos = new Map(turnos.map((t) => [t.pacienteId, t.paciente.telefono]));
  const deudores = calcularDeudores(turnos, ahora);

  // Cuándo se le avisó por última vez a cada una. Va en la misma respuesta
  // porque es lo que evita mandar el mismo SMS dos veces: sin esto la
  // pantalla no tiene cómo saberlo y el botón invita a repetir.
  const ultimoAviso = await ultimoAvisoPorPaciente(
    prisma,
    organizationId,
    deudores.map((d) => d.pacienteId),
  );

  return deudores.map((d) => ({
    pacienteId: d.pacienteId,
    nombre: d.nombre,
    apellido: d.apellido,
    telefono: telefonos.get(d.pacienteId) ?? "",
    sesionesImpagas: d.sesionesImpagas,
    montoTotal: d.montoTotal,
    minutosTotales: d.minutosTotales,
    diasAtraso: d.diasAtraso ?? 0,
    ultimoAvisoEn: ultimoAviso.get(d.pacienteId) ?? null,
  }));
}
