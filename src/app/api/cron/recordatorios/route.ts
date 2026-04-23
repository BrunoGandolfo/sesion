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
  let saltados = 0;
  const errores: string[] = [];

  for (const recordatorio of recordatorios) {
    // `intentos` funciona como version field del lock optimista: si otra
    // instancia del cron ya tomó este recordatorio, su updateMany habrá
    // movido intentos, y el nuestro devolverá count: 0.
    let claimed = false;
    let intentosActual = recordatorio.intentos;

    try {
      const claim = await db.recordatorio.updateMany({
        where: {
          id: recordatorio.id,
          estado: "pendiente",
          intentos: recordatorio.intentos,
        },
        data: { intentos: { increment: 1 } },
      });

      if (claim.count === 0) {
        saltados += 1;
        console.log(
          `[cron][skip] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=tomado-por-otra-instancia ts=${new Date().toISOString()}`,
        );
        continue;
      }

      claimed = true;
      intentosActual = recordatorio.intentos + 1;

      const { turno } = recordatorio;
      const config = turno.organization.configuracion;

      if (!config) {
        throw new Error(`Organización ${turno.organizationId} sin configuración`);
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

      if (!resultado.success) {
        throw new Error(resultado.error ?? "Error desconocido");
      }

      await db.recordatorio.update({
        where: { id: recordatorio.id },
        data: {
          estado: "enviado",
          enviadoEn: new Date(),
          textoEnviado: texto,
          error: null,
        },
      });
      enviados += 1;
      console.log(
        `[cron][ok] turno=${turno.id} id=${recordatorio.id} resultado=enviado intentos=${intentosActual} ts=${new Date().toISOString()}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fallidos += 1;
      errores.push(`Recordatorio ${recordatorio.id}: ${msg}`);

      // Sólo persistimos error si tomamos el lock; si falló la propia
      // updateMany, el registro sigue intacto y lo retomará el próximo tick.
      if (claimed) {
        try {
          await db.recordatorio.update({
            where: { id: recordatorio.id },
            data: {
              error: msg,
              estado: intentosActual >= MAX_INTENTOS ? "fallido" : "pendiente",
            },
          });
        } catch (persistErr) {
          const persistMsg =
            persistErr instanceof Error ? persistErr.message : String(persistErr);
          console.error(
            `[cron][persistencia] turno=${recordatorio.turnoId} id=${recordatorio.id} error="${persistMsg}" ts=${new Date().toISOString()}`,
          );
        }
      }

      console.log(
        `[cron][fallo] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=${
          intentosActual >= MAX_INTENTOS ? "fallido" : "reintento"
        } intentos=${intentosActual} error="${msg}" ts=${new Date().toISOString()}`,
      );
    }
  }

  return Response.json({
    procesados: recordatorios.length,
    enviados,
    fallidos,
    saltados,
    errores,
  });
}
