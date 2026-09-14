// Caso de uso: despachar los SMS cuya hora llegó. Reserva, intento, backoff
// y cierre. Reemplaza a enviar-recordatorios.ts sobre el modelo EnvioSms.
//
// ─── PRINCIPIO ──────────────────────────────────────────────────────────────
//
// La fila registra lo que sabemos, el proveedor nos dice lo que pasó, y lo
// que no sabemos tiene su propio nombre (`desconocido`) y no se adivina.
//
// ─── RESERVAR NO ES INTENTAR ────────────────────────────────────────────────
//
//   1. RESERVA — `pendiente` → `enviando` con un updateMany condicionado: es
//      el lock. No toca `intentos` ni `proximoIntentoEn`.
//   2. INTENTO — justo antes de llamar a Twilio: `intentos + 1` y
//      `proximoIntentoEn = null`. Ese null es la marca de "la llamada pudo
//      haber salido".
//
// Un corte de la función entre 1 y 2 deja `enviando` con `proximoIntentoEn`
// puesto: la corrida siguiente la RESCATA (el lease venció) y la vuelve a
// trabajar sin haber gastado nada. Un corte DESPUÉS de 2 deja `enviando`
// con `proximoIntentoEn` null: Twilio pudo haber aceptado, y no se sabe. El
// rescate NO la reenvía: la pasa a `desconocido`. Es U4/E.15: un timeout no
// duplica.
//
// ─── QUÉ HACE CON CADA RESPUESTA ────────────────────────────────────────────
//
//   aceptado     → `aceptado`, sid, segmentos, aceptadoEn. Espera el callback.
//   transitorio  → backoff (src/lib/sms/backoff.ts): `pendiente` con
//                  proximoIntentoEn, sin tope de intentos, hasta la ventana
//                  útil; después `fallido`; si el turno ya pasó, `cancelado`.
//   definitivo   → `fallido` con el código de Twilio y el motivo en
//                  castellano. Si es 21610, además BajaSms.
//   desconocido  → `desconocido`. Nunca se reenvía solo (decisión del dueño):
//                  la profesional lo ve en el turno.
//   alerta       → las respuestas que son configuración o la cuenta (20003,
//                  21212, 21408, 21606, 30002) vuelven en `alertas` y la ruta
//                  las manda por correo.
//
// ─── ANTES DE LLAMAR A TWILIO ───────────────────────────────────────────────
//
//   - BajaSms: si el teléfono pidió no recibir más, `cancelado`. Se mira acá,
//     en el nivel más bajo, en TODO envío: es una obligación legal y no
//     puede depender de que cada llamador se acuerde.
//   - El turno: cerrado o pasado → `cancelado`, sin gastar nada.
//
// ─── LOS CIERRES NO PISAN UNA CANCELACIÓN ───────────────────────────────────
//
// Mientras Twilio contesta, la profesional puede cancelar el turno, y eso
// escribe `cancelado` en esta fila. Todo cierre condiciona a `enviando`: si
// count es 0, alguien más la movió. Y si el SMS SALIÓ igual (Twilio aceptó
// antes de que llegara la cancelación), la fila se queda en `cancelado` pero
// guarda sid y aceptadoEn con MENSAJE_ENVIADO_TRAS_CANCELACION: la paciente
// tiene un mensaje en el teléfono citándola a una sesión que no existe, y
// la única que puede arreglarlo es la terapeuta llamándola. Esa evidencia
// sale como alerta y como métrica (src/lib/sms/metricas.ts).
//
// ─── PRESUPUESTO ────────────────────────────────────────────────────────────
//
// Deadline de 45 s (de los 60 de la función) para dejar de tomar trabajo
// nuevo, concurrencia 5, timeout de Twilio 10 s. Lo que sobra lo levanta el
// próximo tick (`hayMas`). Y `programadoEn` ya viene disperso
// (recordatorios-programacion.ts): los avisos del día no caen todos juntos.
//
// Sin request, Response ni console: todo vuelve en el resumen.

import type { db } from "@/lib/db";
import { decidirTrasFalloTransitorio, limiteUtilDelTurno } from "@/lib/sms/backoff";
import { URL_CALLBACK } from "@/lib/sms/firma";
import { contarLongitudSms, textoDelEnvio } from "@/lib/sms/texto";
import type { EnviadorSms, ResultadoTwilio } from "@/lib/sms/twilio";
import type { NivelAlerta } from "@/lib/salud-metricas";

import { MOTIVO_TURNO_CERRADO } from "./envios-del-turno";

type ClientePrisma = typeof db;

/** Cuánto puede estar un envío en `enviando` antes de darlo por abandonado.
 *  Holgadamente mayor que la maxDuration de la función (60 s). */
export const RESCATE_MS = 5 * 60_000;

/** Deja de tomar trabajo nuevo pasados estos ms de la corrida. */
export const DEADLINE_MS = 45_000;
export const CONCURRENCIA = 5;
/** Cuántos envíos como máximo lee una corrida. */
export const LOTE = 100;

/** Ventana útil de un aviso sin turno (cobro): un día desde que se pidió. */
export const VENTANA_COBRO_MS = 24 * 60 * 60_000;

export const MOTIVO_BAJA = "la paciente pidió no recibir más mensajes";
export const MOTIVO_TURNO_PASADO = "el turno ya pasó";
export const MOTIVO_RESERVA_HUERFANA =
  "una corrida se cortó después de llamar al servicio de SMS: no se sabe si el mensaje salió";
export const MOTIVO_SIN_TEXTO_DE_COBRO = "no hay deuda vigente para avisar";
export const MENSAJE_ENVIADO_TRAS_CANCELACION =
  "El SMS salió, pero el turno se cerró mientras se enviaba: la paciente recibió un aviso de una sesión que ya no está programada";

export interface AlertaDespacho {
  nivel: NivelAlerta;
  titulo: string;
  detalle: Record<string, string | number | boolean | null>;
}

export interface DespacharParams {
  prisma: ClientePrisma;
  ahora: Date;
  enviar: EnviadorSms;
  /**
   * Texto de un aviso de cobro (motivo recordatorio_cobro), con la deuda
   * vigente. Lo inyecta la ruta porque la deuda es del dominio de cobros.
   * Devuelve null si ya no hay nada que avisar → el envío se cancela.
   */
  textoDeCobro?: (envio: { organizationId: string; pacienteId: string; ahora: Date }) => Promise<string | null>;
  deadlineMs?: number;
  concurrencia?: number;
  rescateMs?: number;
  lote?: number;
  /** Reloj monotónico para el deadline. Inyectable. */
  reloj?: () => number;
  /** [0, 1) para el jitter del backoff. Inyectable. */
  aleatorio?: () => number;
}

export interface ResumenDespacho {
  procesados: number;
  aceptados: number;
  /** Aceptados por Twilio con el turno ya cerrado: pacientes a las que hay
   *  que avisar a mano. */
  aceptadosTrasCancelacion: number;
  reintentos: number;
  fallidos: number;
  cancelados: number;
  desconocidos: number;
  saltados: number;
  rescatados: number;
  /** true si quedó trabajo para el próximo tick (deadline o lote lleno). */
  hayMas: boolean;
  /** Bitácora, una línea por envío evaluado. Sin teléfonos ni texto. */
  eventos: string[];
  /** Fallos al persistir un resultado: la fila puede haber quedado reservada. */
  fallosPersistencia: string[];
  /** Lo que hay que mandar por correo. */
  alertas: AlertaDespacho[];
}

type Candidato = Awaited<ReturnType<typeof leerCandidatos>>[number];

async function leerCandidatos(prisma: ClientePrisma, ahora: Date, corteRescate: Date, lote: number) {
  return prisma.envioSms.findMany({
    where: {
      OR: [
        { estado: "pendiente", proximoIntentoEn: { lte: ahora } },
        { estado: "enviando", actualizadoEn: { lt: corteRescate } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      pacienteId: true,
      turnoId: true,
      motivo: true,
      estado: true,
      destino: true,
      programadoEn: true,
      proximoIntentoEn: true,
      intentos: true,
      paciente: { select: { nombre: true, apellido: true } },
      turno: { select: { estado: true, fecha: true } },
      organization: {
        select: {
          configuracion: {
            select: { nombreProfesional: true, direccion: true, whatsappOrigen: true, templateRecordatorio: true },
          },
        },
      },
    },
    orderBy: { programadoEn: "asc" },
    take: lote,
  });
}

export async function despacharEnvios({
  prisma,
  ahora,
  enviar,
  textoDeCobro,
  deadlineMs = DEADLINE_MS,
  concurrencia = CONCURRENCIA,
  rescateMs = RESCATE_MS,
  lote = LOTE,
  reloj = () => Date.now(),
  aleatorio = () => Math.random(),
}: DespacharParams): Promise<ResumenDespacho> {
  const ts = ahora.toISOString();
  const inicio = reloj();
  const corteRescate = new Date(ahora.getTime() - rescateMs);
  const candidatos = await leerCandidatos(prisma, ahora, corteRescate, lote);

  const resumen: ResumenDespacho = {
    procesados: 0,
    aceptados: 0,
    aceptadosTrasCancelacion: 0,
    reintentos: 0,
    fallidos: 0,
    cancelados: 0,
    desconocidos: 0,
    saltados: 0,
    rescatados: 0,
    hayMas: candidatos.length === lote,
    eventos: [],
    fallosPersistencia: [],
    alertas: [],
  };

  const evento = (tipo: string, e: Candidato, resto = "") => {
    resumen.eventos.push(
      `[sms][${tipo}] envio=${e.id} turno=${e.turnoId ?? "-"} motivo=${e.motivo} intentos=${e.intentos}${resto ? ` ${resto}` : ""} ts=${ts}`,
    );
  };

  /** Escritura de cierre condicionada a `enviando`. */
  const cerrar = async (e: Candidato, data: Parameters<typeof prisma.envioSms.updateMany>[0]["data"]) => {
    const { count } = await prisma.envioSms.updateMany({ where: { id: e.id, estado: "enviando" }, data });
    return count > 0;
  };

  async function procesar(e: Candidato): Promise<void> {
    resumen.procesados += 1;
    const esRescate = e.estado === "enviando";

    const claim = await prisma.envioSms.updateMany({
      where: esRescate
        ? { id: e.id, estado: "enviando", actualizadoEn: { lt: corteRescate } }
        : { id: e.id, estado: "pendiente" },
      data: { estado: "enviando" },
    });
    if (claim.count === 0) {
      resumen.saltados += 1;
      evento("skip", e, "resultado=tomado-por-otra-corrida");
      return;
    }

    let intentoConsumido = false;
    let intentos = e.intentos;

    try {
      if (esRescate) {
        resumen.rescatados += 1;
        if (e.proximoIntentoEn === null) {
          // La corrida anterior murió DESPUÉS de marcar el intento: la
          // llamada pudo haber salido. Nunca se reenvía: desconocido.
          await cerrar(e, { estado: "desconocido", motivoNoEnvio: MOTIVO_RESERVA_HUERFANA });
          resumen.desconocidos += 1;
          evento("rescate", e, "resultado=desconocido-llamada-pudo-salir");
          return;
        }
        evento("rescate", e, "resultado=reserva-huerfana-sin-llamada");
      }

      // Baja: obligación legal, en todo envío, antes que nada.
      const baja = await prisma.bajaSms.findUnique({ where: { telefono: e.destino }, select: { telefono: true } });
      if (baja) {
        await cerrar(e, { estado: "cancelado", motivoNoEnvio: MOTIVO_BAJA, cerradoEn: ahora });
        resumen.cancelados += 1;
        evento("baja", e, "resultado=cancelado");
        return;
      }

      // El turno, si lo hay: cerrado o pasado → no se manda nada.
      if (e.turno) {
        if (e.turno.estado !== "programado") {
          await cerrar(e, { estado: "cancelado", motivoNoEnvio: MOTIVO_TURNO_CERRADO, cerradoEn: ahora });
          resumen.cancelados += 1;
          evento("turno-cerrado", e, "resultado=cancelado");
          return;
        }
        if (e.turno.fecha.getTime() <= ahora.getTime()) {
          await cerrar(e, { estado: "cancelado", motivoNoEnvio: MOTIVO_TURNO_PASADO, cerradoEn: ahora });
          resumen.cancelados += 1;
          evento("turno-pasado", e, "resultado=cancelado");
          return;
        }
      }

      // El texto, en el momento de mandar, con la plantilla vigente.
      let texto: string;
      if (e.motivo === "recordatorio_cobro") {
        const t = textoDeCobro ? await textoDeCobro({ organizationId: e.organizationId, pacienteId: e.pacienteId, ahora }) : null;
        if (!t) {
          await cerrar(e, { estado: "cancelado", motivoNoEnvio: MOTIVO_SIN_TEXTO_DE_COBRO, cerradoEn: ahora });
          resumen.cancelados += 1;
          evento("sin-deuda", e, "resultado=cancelado");
          return;
        }
        texto = t;
      } else {
        const config = e.organization.configuracion;
        if (!config) throw new Error(`Organización ${e.organizationId} sin configuración`);
        if (!e.turno) throw new Error(`Envío ${e.id} de turno sin turno`);
        texto = textoDelEnvio(e.motivo, config.templateRecordatorio, {
          nombre: e.paciente.nombre,
          apellido: e.paciente.apellido,
          fecha: e.turno.fecha,
          direccion: config.direccion,
          profesional: config.nombreProfesional,
          telefonoConsultorio: config.whatsappOrigen,
        });
      }
      const segmentosEstimados = contarLongitudSms(texto).segmentos;

      // El intento se gasta ACÁ. `proximoIntentoEn = null` es la marca de
      // que la llamada pudo haber salido (ver el rescate).
      const consumido = await prisma.envioSms.update({
        where: { id: e.id },
        data: { intentos: { increment: 1 }, proximoIntentoEn: null },
        select: { intentos: true },
      });
      intentoConsumido = true;
      intentos = consumido.intentos;

      let resultado: ResultadoTwilio;
      try {
        resultado = await enviar({ destino: e.destino, texto, statusCallback: URL_CALLBACK });
      } catch (error) {
        // El enviador no lanza; si algo lo hace, no sabemos si el cuerpo
        // viajó. Desconocido, por prudencia.
        const msg = error instanceof Error ? error.message : String(error);
        resultado = { tipo: "desconocido", motivo: `el enviador lanzó: ${msg.slice(0, 120)}` };
      }

      const limiteUtil = e.turno
        ? limiteUtilDelTurno(e.turno.fecha)
        : new Date(e.programadoEn.getTime() + VENTANA_COBRO_MS);

      switch (resultado.tipo) {
        case "aceptado": {
          const segmentos = resultado.segmentos ?? segmentosEstimados;
          const cerrado = await cerrar(e, {
            estado: "aceptado",
            sid: resultado.sid,
            segmentos,
            aceptadoEn: ahora,
            codigoProveedor: null,
            motivoNoEnvio: null,
          });
          resumen.aceptados += 1;
          if (!cerrado) {
            // Salió, y el turno se cerró en el medio. La fila queda
            // cancelada pero con la evidencia: alguien tiene que llamar.
            await prisma.envioSms.updateMany({
              where: { id: e.id, estado: "cancelado" },
              data: { sid: resultado.sid, segmentos, aceptadoEn: ahora, motivoNoEnvio: MENSAJE_ENVIADO_TRAS_CANCELACION },
            });
            resumen.aceptadosTrasCancelacion += 1;
            resumen.alertas.push({
              nivel: "aviso",
              titulo: "Un SMS salió con el turno ya cerrado: hay que avisarle a la paciente",
              detalle: { envioId: e.id, turnoId: e.turnoId, sid: resultado.sid },
            });
            evento("aceptado-tras-cancelacion", e, `sid=${resultado.sid}`);
          } else {
            evento("aceptado", e, `sid=${resultado.sid} segmentos=${segmentos}`);
          }
          return;
        }

        case "transitorio": {
          const decision = decidirTrasFalloTransitorio({
            intentos,
            ahora,
            limiteUtil,
            fechaTurno: e.turno?.fecha ?? null,
            aleatorio: aleatorio(),
            jitterMayor: resultado.clasificacion.jitterMayor,
          });
          const codigo = resultado.codigo !== null ? String(resultado.codigo) : null;
          if (decision.accion === "reintentar") {
            await cerrar(e, { estado: "pendiente", proximoIntentoEn: decision.proximoIntentoEn, codigoProveedor: codigo });
            resumen.reintentos += 1;
            evento("reintento", e, `codigo=${codigo ?? "-"} proximo=${decision.proximoIntentoEn.toISOString()} error="${resultado.mensaje}"`);
          } else if (decision.accion === "fallido") {
            await cerrar(e, { estado: "fallido", codigoProveedor: codigo, motivoNoEnvio: decision.motivo, cerradoEn: ahora });
            resumen.fallidos += 1;
            evento("fallido", e, `codigo=${codigo ?? "-"} error="${resultado.mensaje}"`);
          } else {
            await cerrar(e, { estado: "cancelado", codigoProveedor: codigo, motivoNoEnvio: decision.motivo, cerradoEn: ahora });
            resumen.cancelados += 1;
            evento("cancelado", e, `motivo="${decision.motivo}"`);
          }
          if (resultado.clasificacion.alerta) {
            resumen.alertas.push({
              nivel: resultado.clasificacion.alerta,
              titulo: `El servicio de SMS no puede mandar: ${resultado.mensaje}`,
              detalle: { codigo, httpStatus: resultado.httpStatus, referencia: resultado.clasificacion.referencia },
            });
          }
          return;
        }

        case "definitivo": {
          const codigo = resultado.codigo !== null ? String(resultado.codigo) : null;
          await cerrar(e, {
            estado: "fallido",
            codigoProveedor: codigo,
            motivoNoEnvio: resultado.clasificacion.motivoNoEnvio ?? "el servicio de SMS rechazó el envío",
            cerradoEn: ahora,
          });
          resumen.fallidos += 1;
          evento("fallido", e, `codigo=${codigo ?? "-"} error="${resultado.mensaje}"`);
          if (resultado.clasificacion.baja) {
            await prisma.bajaSms.upsert({
              where: { telefono: e.destino },
              update: {},
              create: { telefono: e.destino, motivo: resultado.clasificacion.baja },
            });
            await prisma.envioSms.updateMany({
              where: { destino: e.destino, estado: { in: ["pendiente", "enviando"] }, id: { not: e.id } },
              data: { estado: "cancelado", motivoNoEnvio: MOTIVO_BAJA, cerradoEn: ahora },
            });
          }
          if (resultado.clasificacion.alerta) {
            resumen.alertas.push({
              nivel: resultado.clasificacion.alerta,
              titulo: `El servicio de SMS rechazó un envío por configuración: ${resultado.mensaje}`,
              detalle: { codigo, httpStatus: resultado.httpStatus, referencia: resultado.clasificacion.referencia },
            });
          }
          return;
        }

        case "desconocido": {
          await cerrar(e, { estado: "desconocido", motivoNoEnvio: resultado.motivo });
          resumen.desconocidos += 1;
          evento("desconocido", e, `motivo="${resultado.motivo}"`);
          return;
        }
      }
    } catch (error) {
      // Un error nuestro (sin configuración, la base) antes o después de
      // Twilio. Si el intento no se consumió, la llamada no salió: se
      // reintenta con backoff. Si se consumió y llegamos acá, es que falló
      // la persistencia del resultado: la fila queda en `enviando` y el
      // rescate la va a pasar a desconocido (proximoIntentoEn es null).
      const msg = error instanceof Error ? error.message : String(error);
      if (!intentoConsumido) {
        try {
          const limiteUtil = e.turno ? limiteUtilDelTurno(e.turno.fecha) : new Date(e.programadoEn.getTime() + VENTANA_COBRO_MS);
          const decision = decidirTrasFalloTransitorio({
            intentos: Math.max(1, intentos),
            ahora,
            limiteUtil,
            fechaTurno: e.turno?.fecha ?? null,
            aleatorio: aleatorio(),
          });
          if (decision.accion === "reintentar") {
            await cerrar(e, { estado: "pendiente", proximoIntentoEn: decision.proximoIntentoEn, motivoNoEnvio: msg.slice(0, 200) });
            resumen.reintentos += 1;
          } else {
            await cerrar(e, { estado: decision.accion, motivoNoEnvio: decision.motivo, cerradoEn: ahora });
            if (decision.accion === "fallido") resumen.fallidos += 1;
            else resumen.cancelados += 1;
          }
        } catch (persistErr) {
          const persistMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
          resumen.fallosPersistencia.push(`[sms][persistencia] envio=${e.id} error="${persistMsg}" ts=${ts}`);
        }
      } else {
        resumen.fallosPersistencia.push(`[sms][persistencia] envio=${e.id} error="${msg}" ts=${ts}`);
      }
      evento("error", e, `error="${msg}"`);
    }
  }

  // Pool de `concurrencia` trabajadores sobre la lista, con deadline.
  let siguiente = 0;
  let cortadoPorDeadline = false;
  const trabajador = async () => {
    for (;;) {
      if (reloj() - inicio > deadlineMs) {
        cortadoPorDeadline = true;
        return;
      }
      const i = siguiente;
      if (i >= candidatos.length) return;
      siguiente += 1;
      await procesar(candidatos[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, candidatos.length) }, trabajador));

  if (cortadoPorDeadline && siguiente < candidatos.length) resumen.hayMas = true;
  return resumen;
}
