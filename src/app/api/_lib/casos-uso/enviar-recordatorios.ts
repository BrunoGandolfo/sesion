// Caso de uso: enviar los recordatorios pendientes cuya hora ya llegó.
//
// Por recordatorio: claim optimista (una sola updateMany condicionada a
// estado "pendiente" + intentos, que además incrementa intentos: si otra
// corrida lo tomó primero, count es 0 y se salta), cierre por vencimiento
// (turno pasado, cancelado o ausente → "cancelado" sin enviar), envío, y
// persistencia del resultado: "enviado" con el texto exacto, o el error con
// "fallido" cuando se agotó `maxIntentos` y "pendiente" si todavía quedan.
//
// Sin request, Response ni console: todo lo que antes se logueaba vuelve en
// `eventos`; los fallos al persistir un error vuelven aparte en
// `fallosPersistencia` para que el handler decida qué hacer con ellos.

import type { db } from "@/lib/db";
import {
  estaVencido,
  type SmsMessage,
  type SmsResult,
} from "@/lib/recordatorios-sms";
import { asegurarLineaContacto, buildSmsMessage } from "@/lib/sms-texto";

type ClientePrisma = typeof db;

export type EnviarSms = (mensaje: SmsMessage) => Promise<SmsResult>;

export interface EnviarRecordatoriosParams {
  prisma: ClientePrisma;
  ahora: Date;
  enviarSms: EnviarSms;
  /** Intentos (claims) tras los cuales el recordatorio pasa a "fallido". */
  maxIntentos: number;
}

export interface ResumenRecordatorios {
  procesados: number;
  enviados: number;
  fallidos: number;
  saltados: number;
  vencidos: number;
  /** Un texto por recordatorio fallido: "Recordatorio <id>: <error>". */
  errores: string[];
  /** Bitácora de la corrida, una línea por recordatorio evaluado. */
  eventos: string[];
  /** Errores al persistir el resultado de un fallo (la fila puede haber
   *  quedado con intentos incrementado y sin error guardado). */
  fallosPersistencia: string[];
}

export async function enviarRecordatoriosVencidos({
  prisma,
  ahora,
  enviarSms,
  maxIntentos,
}: EnviarRecordatoriosParams): Promise<ResumenRecordatorios> {
  const ts = ahora.toISOString();

  const recordatorios = await prisma.recordatorio.findMany({
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

  const resumen: ResumenRecordatorios = {
    procesados: recordatorios.length,
    enviados: 0,
    fallidos: 0,
    saltados: 0,
    vencidos: 0,
    errores: [],
    eventos: [],
    fallosPersistencia: [],
  };

  for (const recordatorio of recordatorios) {
    // `intentos` funciona como version field del lock optimista: si otra
    // corrida ya tomó este recordatorio, su updateMany habrá movido
    // intentos, y el nuestro devolverá count: 0.
    let reclamado = false;
    let intentosActual = recordatorio.intentos;

    try {
      const claim = await prisma.recordatorio.updateMany({
        where: {
          id: recordatorio.id,
          estado: "pendiente",
          intentos: recordatorio.intentos,
        },
        data: { intentos: { increment: 1 } },
      });

      if (claim.count === 0) {
        resumen.saltados += 1;
        resumen.eventos.push(
          `[cron][skip] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=tomado-por-otra-instancia ts=${ts}`,
        );
        continue;
      }

      reclamado = true;
      intentosActual = recordatorio.intentos + 1;

      const { turno } = recordatorio;

      // Turno pasado, cancelado o ausente: no se envía. Se cierra el
      // recordatorio con el motivo en `error` (el modelo no tiene "motivo").
      if (estaVencido(turno, ahora)) {
        const motivo =
          turno.estado === "cancelado" || turno.estado === "ausente"
            ? "turno_cancelado"
            : "vencido";
        await prisma.recordatorio.updateMany({
          where: { id: recordatorio.id, intentos: intentosActual },
          data: { estado: "cancelado", error: motivo },
        });
        resumen.vencidos += 1;
        resumen.eventos.push(
          `[cron][vencido] turno=${turno.id} id=${recordatorio.id} resultado=${motivo} ts=${ts}`,
        );
        continue;
      }

      const config = turno.organization.configuracion;

      if (!config) {
        throw new Error(`Organización ${turno.organizationId} sin configuración`);
      }

      const texto = buildSmsMessage(
        asegurarLineaContacto(config.templateRecordatorio),
        {
          nombre: turno.paciente.nombre,
          apellido: turno.paciente.apellido,
          fecha: turno.fecha,
          direccion: config.direccion,
          profesional: config.nombreProfesional,
          telefonoConsultorio: config.whatsappOrigen,
        },
      );

      const resultado = await enviarSms({
        to: turno.paciente.telefono,
        text: texto,
      });

      if (!resultado.success) {
        throw new Error(resultado.error ?? "Error desconocido");
      }

      await prisma.recordatorio.update({
        where: { id: recordatorio.id },
        data: {
          estado: "enviado",
          enviadoEn: ahora,
          textoEnviado: texto,
          error: null,
        },
      });
      resumen.enviados += 1;
      resumen.eventos.push(
        `[cron][ok] turno=${turno.id} id=${recordatorio.id} resultado=enviado intentos=${intentosActual} ts=${ts}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumen.fallidos += 1;
      resumen.errores.push(`Recordatorio ${recordatorio.id}: ${msg}`);

      // Sólo persistimos error si tomamos el lock; si falló la propia
      // updateMany, el registro sigue intacto y lo retomará el próximo tick.
      if (reclamado) {
        try {
          await prisma.recordatorio.update({
            where: { id: recordatorio.id },
            data: {
              error: msg,
              estado: intentosActual >= maxIntentos ? "fallido" : "pendiente",
            },
          });
        } catch (persistErr) {
          const persistMsg =
            persistErr instanceof Error ? persistErr.message : String(persistErr);
          resumen.fallosPersistencia.push(
            `[cron][persistencia] turno=${recordatorio.turnoId} id=${recordatorio.id} error="${persistMsg}" ts=${ts}`,
          );
        }
      }

      resumen.eventos.push(
        `[cron][fallo] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=${
          intentosActual >= maxIntentos ? "fallido" : "reintento"
        } intentos=${intentosActual} error="${msg}" ts=${ts}`,
      );
    }
  }

  return resumen;
}
