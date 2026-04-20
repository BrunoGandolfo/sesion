import { db } from "@/lib/db";
import { buildReminderMessage, sendWhatsApp } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTENTOS = 3;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const ahora = new Date();

  const recordatorios = await db.recordatorio.findMany({
    where: {
      estado: "pendiente",
      programadoEn: { lte: ahora },
    },
    include: {
      turno: {
        include: {
          paciente: true,
          organization: { include: { configuracion: true } },
        },
      },
    },
  });

  let enviados = 0;
  let fallidos = 0;
  const errores: string[] = [];

  for (const recordatorio of recordatorios) {
    const { turno } = recordatorio;
    const config = turno.organization.configuracion;

    if (!config) {
      const err = `Organización ${turno.organizationId} sin configuración`;
      errores.push(err);
      fallidos += 1;
      const intentos = recordatorio.intentos + 1;
      await db.recordatorio.update({
        where: { id: recordatorio.id },
        data: {
          intentos,
          error: err,
          estado: intentos >= MAX_INTENTOS ? "fallido" : "pendiente",
        },
      });
      continue;
    }

    const texto = buildReminderMessage(config.templateRecordatorio, {
      nombre: turno.paciente.nombre,
      apellido: turno.paciente.apellido,
      fecha: turno.fecha,
      direccion: config.direccion,
      profesional: config.nombreProfesional,
    });

    const resultado = await sendWhatsApp({
      to: turno.paciente.telefono,
      text: texto,
    });

    if (resultado.success) {
      enviados += 1;
      await db.recordatorio.update({
        where: { id: recordatorio.id },
        data: {
          estado: "enviado",
          enviadoEn: new Date(),
          textoEnviado: texto,
          intentos: recordatorio.intentos + 1,
          error: null,
        },
      });
    } else {
      fallidos += 1;
      const err = resultado.error ?? "Error desconocido";
      errores.push(`Recordatorio ${recordatorio.id}: ${err}`);
      const intentos = recordatorio.intentos + 1;
      await db.recordatorio.update({
        where: { id: recordatorio.id },
        data: {
          intentos,
          error: err,
          estado: intentos >= MAX_INTENTOS ? "fallido" : "pendiente",
        },
      });
    }
  }

  return Response.json({
    procesados: recordatorios.length,
    enviados,
    fallidos,
    errores,
  });
}
