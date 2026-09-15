// Renovar el lease: el worker lo llama cada minuto mientras trabaja. Sólo
// con el intento vigente; un worker con un intento viejo recibe 409 y sabe
// que tiene que abandonar la corrida.

import type { PausaMedida } from "@/lib/sesion-clinica/schema";
import { LEASE_SESION_MS } from "@/lib/sesion-clinica/estados";

import { transicionar, type ClienteSesion } from "./transicion";

export interface RenovarLeaseInput {
  prisma: ClienteSesion;
  sesionId: string;
  organizationId: string;
  intento: number;
  ahora?: Date;
  pausasAudio?: PausaMedida[];
}

export async function renovarLease({
  prisma,
  sesionId,
  organizationId,
  intento,
  ahora = new Date(),
  pausasAudio,
}: RenovarLeaseInput): Promise<{ leaseVenceEn: Date }> {
  const leaseVenceEn = new Date(ahora.getTime() + LEASE_SESION_MS);
  await transicionar({
    prisma,
    operacion: "renovar_lease",
    sesionId,
    organizationId,
    intento,
    data: { leaseVenceEn, ...(pausasAudio !== undefined ? { pausas: pausasAudio } : {}) },
    conflicto: "El intento ya no es el vigente; abandoná la corrida.",
  });
  return { leaseVenceEn };
}
