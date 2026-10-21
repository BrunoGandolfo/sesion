// El texto del aviso de cobro con la deuda de HOY: la misma plantilla de la
// organización y la misma función (textoDelCobro) que la pantalla de Cobros,
// así lo que ella confirmó es lo que sale. Null si la paciente ya no debe
// nada (el despachador cancela el envío). Lo llama el cron de SMS a través del gancho `textoDeCobro` de
// despachar-sms.ts.

import type { db } from "@/lib/db";
import { TEMPLATE_COBRO_DEFAULT, textoDelCobro } from "@/lib/deudas";

import { deudaDePaciente } from "../domain";

type ClientePrisma = typeof db;

/** Sin configuración (no debería pasar: se crea con la cuenta) sale el texto
 *  de siempre, sin firma. */
const CONFIGURACION_SIN_CARGAR = { templateCobro: TEMPLATE_COBRO_DEFAULT, nombreProfesional: "", direccion: "", whatsappOrigen: "" };

export async function textoDeCobro(
  prisma: ClientePrisma,
  { organizationId, pacienteId, ahora }: { organizationId: string; pacienteId: string; ahora: Date },
): Promise<string | null> {
  const [paciente, configuracion, deuda] = await Promise.all([
    prisma.paciente.findFirst({ where: { id: pacienteId, organizationId }, select: { nombre: true, apellido: true } }),
    prisma.configuracion.findUnique({
      where: { organizationId },
      select: { templateCobro: true, nombreProfesional: true, direccion: true, whatsappOrigen: true },
    }),
    deudaDePaciente(prisma, organizationId, pacienteId, ahora),
  ]);
  if (!paciente || !deuda) return null;
  return textoDelCobro(configuracion ?? CONFIGURACION_SIN_CARGAR, paciente, {
    sesiones: deuda.sesionesImpagas,
    monto: deuda.montoTotal,
  });
}
