// Caso de uso: enviar los recordatorios pendientes cuya hora ya llegó.
//
// ─── RESERVAR NO ES INTENTAR ────────────────────────────────────────────────
//
// La versión anterior tomaba el recordatorio con un updateMany que a la vez
// incrementaba `intentos`: reservar y gastar un intento eran el mismo acto.
// En una función serverless eso tiene un costo concreto: si la corrida se
// corta después de reservar y antes de llamar a Twilio (timeout, la lambda
// que se muere, un deploy en el medio), el recordatorio quedó con un intento
// menos sin que nadie haya mandado nada. Con maxIntentos = 3, tres cortes
// dejan un recordatorio "fallido" que Twilio no vio nunca.
//
// Ahora son dos actos distintos, con dos escrituras distintas:
//
//   1. RESERVA — el recordatorio pasa a estado "enviando". Es un lease: dice
//      "esta corrida lo está trabajando", no dice que se haya intentado
//      nada. No toca `intentos`.
//   2. INTENTO — `intentos + 1`, justo antes de llamar a Twilio. A partir de
//      acá el intento está gastado, se haya recibido respuesta o no (puede
//      haber salido el SMS: no se puede saber, así que se cuenta).
//
// Un corte entre 1 y 2 deja la fila en "enviando" con los intentos intactos.
// La corrida siguiente la RESCATA —el lease venció— y la vuelve a trabajar
// sin haber gastado nada. Un corte entre 2 y el cierre también se rescata,
// pero ahí el intento ya está contado, así que el reintento es acotado y no
// hay bucle infinito de SMS.
//
// El estado "enviando" no necesita columna nueva: `estado` es un String sin
// enum en la base (ver prisma/schema.prisma), así que agregar un valor es
// sólo agregar el literal a RecordatorioEstado en src/types/domain.ts.
//
// Errores que se lanzan ANTES de llamar a Twilio (organización sin
// configuración, por ejemplo) sí gastan el intento: son fallas
// deterministas, no cortes. Un corte no lanza nada — mata el proceso.
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

/** Cuántos recordatorios como máximo procesa una corrida. */
export const TOPE_POR_CORRIDA = 20;

/**
 * Cuánto puede estar un recordatorio en "enviando" antes de darlo por
 * abandonado. Tiene que ser holgadamente mayor que la maxDuration de la
 * función: mientras la corrida siga viva, nadie más debe tocarlo.
 */
export const RESCATE_MS = 5 * 60_000;

/**
 * Motivo con que se cierra una reserva huérfana que ya no tiene intentos.
 * Queda en la columna `error` del recordatorio: si aparece, lo que hay que
 * mirar es por qué se corta la corrida siempre en el mismo punto.
 */
export const MENSAJE_INTENTOS_AGOTADOS =
  "Reserva huérfana sin intentos disponibles: no se reintenta el envío";

/**
 * Estados desde los que un recordatorio TODAVÍA puede terminar mandando un
 * SMS: "pendiente" (espera su hora) y "enviando" (reservado por una corrida,
 * esté viva o muerta).
 *
 * Quien cancela o reprograma un turno tiene que apagar los dos. Apagar sólo
 * "pendiente" —lo que se hacía— deja viva la reserva de una corrida que se
 * murió: el rescate la levanta, lee la fecha NUEVA del turno y manda el
 * recordatorio en el acto, días antes de tiempo; y el recordatorio de
 * reemplazo manda otro a su hora. Dos mensajes, uno de ellos a destiempo.
 *
 * Vive acá, al lado del rescate, porque es el rescate el que le da sentido a
 * "enviando": si mañana aparece otro estado que pueda derivar en un envío,
 * este arreglo se hace en un solo lugar.
 */
export const ESTADOS_CON_ENVIO_PENDIENTE = ["pendiente", "enviando"] as const;

/**
 * Qué dice la fila cuando el SMS SALIÓ pero el turno se cerró mientras
 * Twilio contestaba.
 *
 * La decisión, porque no es obvia y conviene que esté escrita:
 *
 *   - El estado se queda en "cancelado", no pasa a "enviado". "Enviado"
 *     significa "el recordatorio hizo su trabajo", y este no lo hizo: avisó
 *     de una sesión que ya no existe. Además "cancelado" es terminal — nadie
 *     lo vuelve a tomar — mientras que cualquier otro estado reabre la
 *     puerta a un segundo mensaje.
 *   - Pero `enviadoEn` y `textoEnviado` SÍ se llenan, y `error` guarda este
 *     texto. Porque el hecho ocurrió: la paciente tiene un SMS en el
 *     teléfono diciéndole que venga. Borrar esa evidencia para que la fila
 *     quede prolija sería mentirle a la única persona que puede arreglarlo,
 *     que es la terapeuta llamándola.
 *
 * La carrera es estrecha (hay que cancelar el turno exactamente mientras
 * Twilio responde) pero real, y con datos clínicos la respuesta a "es
 * improbable" es dejarlo registrado, no ignorarlo.
 */
export const MENSAJE_ENVIADO_TRAS_CANCELACION =
  "El SMS salió, pero el turno se cerró mientras se enviaba: la paciente recibió un aviso de una sesión que ya no está programada";

export interface EnviarRecordatoriosParams {
  prisma: ClientePrisma;
  ahora: Date;
  enviarSms: EnviarSms;
  /** Intentos (llamadas a Twilio) tras los cuales pasa a "fallido". */
  maxIntentos: number;
  /** Tope de recordatorios por corrida. Default: TOPE_POR_CORRIDA. */
  tope?: number;
  /** Antigüedad a partir de la cual un "enviando" se rescata. */
  rescateMs?: number;
}

export interface ResumenRecordatorios {
  procesados: number;
  /** SMS que salieron. Incluye los de `enviadosTrasCancelacion`. */
  enviados: number;
  /** SMS que salieron con el turno ya cerrado (ver
   *  MENSAJE_ENVIADO_TRAS_CANCELACION). Cualquier número mayor que 0 es algo
   *  que la terapeuta tiene que saber: hay una paciente con un aviso falso. */
  enviadosTrasCancelacion: number;
  fallidos: number;
  saltados: number;
  vencidos: number;
  /** Recordatorios que habían quedado reservados por una corrida que se
   *  cortó y esta corrida retomó sin gastarles un intento. */
  rescatados: number;
  /** true si se alcanzó el tope: quedaron recordatorios para el próximo tick. */
  hayMas: boolean;
  /** Un texto por recordatorio fallido: "Recordatorio <id>: <error>". */
  errores: string[];
  /** Bitácora de la corrida, una línea por recordatorio evaluado. */
  eventos: string[];
  /** Errores al persistir el resultado de un fallo (la fila puede haber
   *  quedado reservada y sin error guardado). */
  fallosPersistencia: string[];
}

export async function enviarRecordatoriosVencidos({
  prisma,
  ahora,
  enviarSms,
  maxIntentos,
  tope = TOPE_POR_CORRIDA,
  rescateMs = RESCATE_MS,
}: EnviarRecordatoriosParams): Promise<ResumenRecordatorios> {
  const ts = ahora.toISOString();
  const corteRescate = new Date(ahora.getTime() - rescateMs);

  // Dos orígenes: los que llegaron a su hora y los que quedaron reservados
  // por una corrida que no terminó. `take` acota la corrida al tiempo que la
  // función tiene; lo que sobra lo levanta el próximo tick, más viejo
  // primero.
  const recordatorios = await prisma.recordatorio.findMany({
    where: {
      OR: [
        { estado: "pendiente", programadoEn: { lte: ahora } },
        { estado: "enviando", actualizadoEn: { lt: corteRescate } },
      ],
    },
    include: {
      turno: {
        include: {
          paciente: true,
          organization: { include: { configuracion: true } },
        },
      },
    },
    orderBy: { programadoEn: "asc" },
    take: tope,
  });

  const resumen: ResumenRecordatorios = {
    procesados: recordatorios.length,
    enviados: 0,
    enviadosTrasCancelacion: 0,
    fallidos: 0,
    saltados: 0,
    vencidos: 0,
    rescatados: 0,
    hayMas: recordatorios.length === tope,
    errores: [],
    eventos: [],
    fallosPersistencia: [],
  };

  for (const recordatorio of recordatorios) {
    const esRescate = recordatorio.estado === "enviando";
    let reclamado = false;
    let intentoConsumido = false;
    let intentosActual = recordatorio.intentos;

    try {
      // Reserva. La condición del where es la que hace de lock: si otra
      // corrida ya lo tomó, el estado o el actualizadoEn ya no coinciden y
      // count vuelve 0. `actualizadoEn` es @updatedAt, así que esta misma
      // escritura renueva el lease.
      const claim = await prisma.recordatorio.updateMany({
        where: esRescate
          ? { id: recordatorio.id, estado: "enviando", actualizadoEn: { lt: corteRescate } }
          : { id: recordatorio.id, estado: "pendiente" },
        data: { estado: "enviando" },
      });

      if (claim.count === 0) {
        resumen.saltados += 1;
        resumen.eventos.push(
          `[cron][skip] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=tomado-por-otra-instancia ts=${ts}`,
        );
        continue;
      }

      reclamado = true;

      if (esRescate) {
        resumen.rescatados += 1;
        resumen.eventos.push(
          `[cron][rescate] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=reserva-huerfana intentos=${intentosActual} ts=${ts}`,
        );
      }

      // Sin intentos disponibles no se llama a Twilio: se cierra como fallido.
      //
      // El caso es el de una corrida que murió DESPUÉS de gastar el último
      // intento y ANTES de cerrar la fila. Queda en "enviando" con
      // intentos === maxIntentos, y sin esta guarda el rescate le sumaría uno
      // más y mandaría el cuarto SMS de tres. Peor: si la corrida se muere
      // siempre en el mismo lugar, el ciclo no se corta nunca — cada rescate
      // manda otro mensaje. El tope de intentos sólo se respetaba en la rama
      // de error, y un corte no lanza ningún error.
      //
      // La guarda no distingue rescate de pendiente a propósito: un
      // "pendiente" con los intentos agotados no debería existir (la rama de
      // error lo habría pasado a "fallido"), y si existe igual la respuesta
      // correcta es la misma.
      if (intentosActual >= maxIntentos) {
        await prisma.recordatorio.updateMany({
          where: { id: recordatorio.id, estado: "enviando" },
          data: { estado: "fallido", error: MENSAJE_INTENTOS_AGOTADOS },
        });
        resumen.fallidos += 1;
        resumen.errores.push(
          `Recordatorio ${recordatorio.id}: ${MENSAJE_INTENTOS_AGOTADOS}`,
        );
        resumen.eventos.push(
          `[cron][agotado] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=fallido intentos=${intentosActual} ts=${ts}`,
        );
        continue;
      }

      const { turno } = recordatorio;

      // Turno pasado, cancelado o ausente: no se envía. Se cierra el
      // recordatorio con el motivo en `error` (el modelo no tiene "motivo").
      // No gasta intento: no hubo llamada a Twilio ni la va a haber.
      if (estaVencido(turno, ahora)) {
        const motivo =
          turno.estado === "cancelado" || turno.estado === "ausente"
            ? "turno_cancelado"
            : "vencido";
        await prisma.recordatorio.updateMany({
          where: { id: recordatorio.id, estado: "enviando" },
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

      // El intento se gasta ACÁ, con el mensaje ya armado y la llamada a
      // punto de salir. `update` (no updateMany) para leer el valor
      // resultante: el lease garantiza que nadie más lo está moviendo.
      const consumido = await prisma.recordatorio.update({
        where: { id: recordatorio.id },
        data: { intentos: { increment: 1 } },
        select: { intentos: true },
      });
      intentoConsumido = true;
      intentosActual = consumido.intentos;

      const resultado = await enviarSms({
        to: turno.paciente.telefono,
        text: texto,
      });

      if (!resultado.success) {
        throw new Error(resultado.error ?? "Error desconocido");
      }

      // El cierre condiciona a "enviando": mientras Twilio contestaba, la
      // terapeuta puede haber cancelado o reprogramado el turno, y eso
      // escribió "cancelado" en esta misma fila. Un `update` por id la
      // pisaba y perdía la cancelación.
      const cerrado = await prisma.recordatorio.updateMany({
        where: { id: recordatorio.id, estado: "enviando" },
        data: {
          estado: "enviado",
          enviadoEn: ahora,
          textoEnviado: texto,
          error: null,
        },
      });

      resumen.enviados += 1;

      if (cerrado.count === 0) {
        // El SMS SALIÓ y el turno se canceló en el medio. Ver
        // MENSAJE_ENVIADO_TRAS_CANCELACION: la fila se queda en "cancelado"
        // (estado terminal, nadie la reenvía) pero guarda la evidencia de
        // que el mensaje se mandó, que es lo que la terapeuta necesita para
        // llamar a la paciente y desmentirlo.
        await prisma.recordatorio.updateMany({
          where: { id: recordatorio.id, estado: "cancelado" },
          data: {
            enviadoEn: ahora,
            textoEnviado: texto,
            error: MENSAJE_ENVIADO_TRAS_CANCELACION,
          },
        });
        resumen.enviadosTrasCancelacion += 1;
        resumen.eventos.push(
          `[cron][enviado-tras-cancelacion] turno=${turno.id} id=${recordatorio.id} resultado=sms-salido-turno-cancelado intentos=${intentosActual} ts=${ts}`,
        );
      } else {
        resumen.eventos.push(
          `[cron][ok] turno=${turno.id} id=${recordatorio.id} resultado=enviado intentos=${intentosActual} ts=${ts}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumen.fallidos += 1;
      resumen.errores.push(`Recordatorio ${recordatorio.id}: ${msg}`);

      // Un error lanzado antes de llegar a Twilio (sin configuración, por
      // ejemplo) también gasta el intento: es una falla determinista que se
      // va a repetir igual, no un corte. Un corte no lanza: mata el proceso.
      const intentosFinal = intentoConsumido ? intentosActual : intentosActual + 1;

      // Sólo se persiste si tomamos la reserva; si falló la propia
      // updateMany, la fila sigue intacta y la retoma el próximo tick.
      if (reclamado) {
        try {
          // Condicionado a "enviando", igual que el cierre feliz. Sin eso,
          // devolver la fila a "pendiente" REVIVÍA un recordatorio que la
          // terapeuta acababa de cancelar: quedaba vivo, con `programadoEn`
          // viejo, y el próximo tick lo mandaba en el acto. Era el agujero
          // por el que se escapaba el arreglo del PR #13 (cancelar/reprogramar
          // apaga pendiente y enviando) cada vez que Twilio fallaba.
          const cerrado = await prisma.recordatorio.updateMany({
            where: { id: recordatorio.id, estado: "enviando" },
            data: {
              ...(intentoConsumido ? {} : { intentos: { increment: 1 } }),
              error: msg,
              estado: intentosFinal >= maxIntentos ? "fallido" : "pendiente",
            },
          });

          if (cerrado.count === 0) {
            // El turno se cerró mientras el envío fallaba. No hay nada que
            // salvar —el SMS no salió— y la fila ya está en su estado final.
            resumen.eventos.push(
              `[cron][fallo-descartado] turno=${recordatorio.turnoId} id=${recordatorio.id} resultado=turno-cerrado-durante-el-envio error="${msg}" ts=${ts}`,
            );
          }
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
          intentosFinal >= maxIntentos ? "fallido" : "reintento"
        } intentos=${intentosFinal} error="${msg}" ts=${ts}`,
      );
    }
  }

  return resumen;
}
