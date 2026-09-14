// El texto del aviso de cobro con la deuda de HOY: el mismo template y el
// mismo money() que la pantalla de Cobros, así lo que ella confirmó es lo
// que sale. Null si la paciente ya no debe nada (el despachador cancela el
// envío). Lo llama el cron de SMS a través del gancho `textoDeCobro` de
// despachar-sms.ts.

import type { db } from "@/lib/db";
import { interpolarTemplateCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import { money } from "@/lib/format";

import { buscarTurnosConDeuda, calcularDeudores } from "../domain";

type ClientePrisma = typeof db;

export async function textoDeCobro(
  prisma: ClientePrisma,
  { organizationId, pacienteId, ahora }: { organizationId: string; pacienteId: string; ahora: Date },
): Promise<string | null> {
  const [paciente, configuracion, turnos] = await Promise.all([
    prisma.paciente.findFirst({ where: { id: pacienteId, organizationId }, select: { nombre: true } }),
    prisma.configuracion.findUnique({ where: { organizationId }, select: { nombreProfesional: true } }),
    buscarTurnosConDeuda(prisma, organizationId, pacienteId),
  ]);
  if (!paciente) return null;
  const [deuda] = calcularDeudores(turnos, ahora);
  if (!deuda || deuda.sesionesImpagas === 0) return null;
  return interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
    nombre: paciente.nombre,
    sesiones: deuda.sesionesImpagas,
    monto: money(deuda.montoTotal),
    profesional: configuracion?.nombreProfesional ?? "",
  });
}
