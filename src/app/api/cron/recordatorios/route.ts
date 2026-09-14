// Cron de SMS. Se autentica con CRON_SECRET. Cada 5 minutos.
//
// La política (reserva, intento, backoff, cierre) vive en
// _lib/casos-uso/despachar-sms.ts. Acá sólo auth, el enviador real, el
// texto de los avisos de cobro (que necesita la deuda vigente), las alertas
// por correo y la respuesta. La bitácora vuelve en la respuesta (`eventos`);
// a consola sólo van los fallos al persistir, que dejan la fila inconsistente.
//
// Sin Twilio configurado no se toca ningún envío: quedan pendientes. Eso lo
// grita el validador de entorno (/api/health en 503 y la métrica crítica del
// cron de salud), no este cron.

import { db } from "@/lib/db";
import { alertar } from "@/lib/alertas";
import { interpolarTemplateCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import { money } from "@/lib/format";
import { enviarSmsTwilio, smsConfigurado } from "@/lib/sms/twilio";

import { requireCron } from "../../_lib/auth";
import { despacharEnvios } from "../../_lib/casos-uso/despachar-sms";
import { buscarTurnosConDeuda, calcularDeudores } from "../../_lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

/** El texto del aviso de cobro con la deuda de HOY: el mismo template y el
 *  mismo money() que la pantalla de Cobros. Null si ya no debe nada. */
async function textoDeCobro({ organizationId, pacienteId }: { organizationId: string; pacienteId: string }) {
  const ahora = new Date();
  const [paciente, configuracion, turnos] = await Promise.all([
    db.paciente.findFirst({ where: { id: pacienteId, organizationId }, select: { nombre: true } }),
    db.configuracion.findUnique({ where: { organizationId }, select: { nombreProfesional: true } }),
    buscarTurnosConDeuda(db, organizationId, pacienteId),
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

export async function GET(request: Request) {
  const denegado = requireCron(request);
  if (denegado) return denegado;

  const ahora = new Date();
  const cfg = smsConfigurado();
  if (!cfg.ok) {
    return Response.json({
      procesados: 0,
      hayMas: false,
      desactivado: cfg.motivo,
      eventos: [`[sms] desactivado: ${cfg.motivo === "falta_from" ? "falta TWILIO_SMS_FROM" : "faltan credenciales de Twilio"} ts=${ahora.toISOString()}`],
    });
  }

  const resumen = await despacharEnvios({
    prisma: db,
    ahora,
    enviar: enviarSmsTwilio,
    textoDeCobro,
  });

  for (const fallo of resumen.fallosPersistencia) console.error(fallo);

  // Una alerta por corrida como mucho por cada título distinto: Twilio caído
  // produce el mismo código en los cinco envíos concurrentes.
  const vistas = new Set<string>();
  let alertasEnviadas = 0;
  for (const a of resumen.alertas) {
    if (vistas.has(a.titulo)) continue;
    vistas.add(a.titulo);
    if (await alertar(a.nivel, a.titulo, a.detalle, { ahora })) alertasEnviadas += 1;
  }

  return Response.json({ ...resumen, alertas: resumen.alertas.length, alertasEnviadas });
}
