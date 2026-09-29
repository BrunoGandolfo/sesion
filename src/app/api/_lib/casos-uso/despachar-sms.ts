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
//   - La paciente archivada: ni siquiera es candidata (leerCandidatos).
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

import { SMS_MOTIVOS, MOTIVO_BAJA, MOTIVO_TURNO_PASADO, MOTIVO_RESERVA_HUERFANA, MOTIVO_SIN_TEXTO_DE_COBRO, MENSAJE_ENVIADO_TRAS_CANCELACION } from "@/lib/glosario";
import type { db } from "@/lib/db";
import { decidirTrasFalloTransitorio, limiteUtilDelTurno } from "@/lib/sms/backoff";
import { URL_CALLBACK } from "@/lib/sms/firma";
import { contarLongitudSms, textoDelEnvio } from "@/lib/sms/texto";
import type { EnviadorSms, ResultadoTwilio } from "@/lib/sms/twilio";
import type { NivelAlerta } from "@/lib/salud-metricas";

import {
  cancelarPendientesDelDestino,
  correspondeEnvio,
  MOTIVO_TURNO_CERRADO,
  turnoSigueProgramado,
} from "./envios-del-turno";

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

export { MOTIVO_BAJA } from "@/lib/glosario";

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
      // Defensa en profundidad: archivar ya cancela lo pendiente
      // (cancelarEnviosDeLaPaciente), pero a una paciente archivada no le
      // sale un SMS aunque algo haya quedado vivo.
      paciente: { activo: true },
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

/** Lo que una corrida comparte con cada envío que procesa. */
interface Corrida {
  prisma: ClientePrisma;
  ahora: Date;
  resumen: ResumenDespacho;
  aleatorio: () => number;
  textoDeCobro: DespacharParams["textoDeCobro"];
  enviar: EnviadorSms;
  /** Una línea de bitácora del envío. */
  evento: (tipo: string, e: Candidato, resto?: string) => void;
  /** Escritura de cierre condicionada a `enviando`: false si otro la movió. */
  cerrar: (e: Candidato, data: DatosCierre) => Promise<boolean>;
}

type DatosCierre = Parameters<ClientePrisma["envioSms"]["updateMany"]>[0]["data"];

/** Hasta cuándo sirve el aviso: el de un turno, un rato antes del turno; el
 *  de cobro, un día desde que se pidió. */
function limiteUtilDe(e: Candidato): Date {
  return e.turno ? limiteUtilDelTurno(e.turno.fecha) : new Date(e.programadoEn.getTime() + VENTANA_COBRO_MS);
}

const aCodigo = (codigo: number | null) => (codigo !== null ? String(codigo) : null);

// ─── Cortes previos: lo que cancela el envío antes de gastar nada ──────────
//
// En este orden. La baja primero: es una obligación legal y vale en TODO
// envío. Después el turno, si lo hay: cerrado o pasado no se avisa.

interface CortePrevio {
  motivo: string;
  evento: string;
}

type ReglaDeCorte = (e: Candidato, ctx: { ahora: Date; baja: boolean }) => CortePrevio | null;

const CORTES_PREVIOS: ReadonlyArray<ReglaDeCorte> = [
  (_e, { baja }) => (baja ? { motivo: MOTIVO_BAJA, evento: "baja" } : null),
  (e) =>
    e.turno && !turnoSigueProgramado(e.turno.estado)
      ? { motivo: MOTIVO_TURNO_CERRADO, evento: "turno-cerrado" }
      : null,
  (e, { ahora }) =>
    e.turno && !correspondeEnvio(e.turno.fecha, ahora)
      ? { motivo: MOTIVO_TURNO_PASADO, evento: "turno-pasado" }
      : null,
];

async function cortePrevio(c: Corrida, e: Candidato): Promise<CortePrevio | null> {
  const baja = (await c.prisma.bajaSms.findUnique({ where: { telefono: e.destino }, select: { telefono: true } })) !== null;
  for (const regla of CORTES_PREVIOS) {
    const corte = regla(e, { ahora: c.ahora, baja });
    if (corte) return corte;
  }
  return null;
}

/** El texto, en el momento de mandar, con la plantilla vigente. null si un
 *  aviso de cobro ya no tiene deuda que avisar. */
async function textoDe(c: Corrida, e: Candidato): Promise<string | null> {
  if (e.motivo === "recordatorio_cobro") {
    return c.textoDeCobro
      ? c.textoDeCobro({ organizationId: e.organizationId, pacienteId: e.pacienteId, ahora: c.ahora })
      : null;
  }
  const config = e.organization.configuracion;
  if (!config) throw new Error(`Organización ${e.organizationId} sin configuración`);
  if (!e.turno) throw new Error(`Envío ${e.id} de turno sin turno`);
  return textoDelEnvio(e.motivo, config.templateRecordatorio, {
    nombre: e.paciente.nombre,
    apellido: e.paciente.apellido,
    fecha: e.turno.fecha,
    direccion: config.direccion,
    profesional: config.nombreProfesional,
    telefonoConsultorio: config.whatsappOrigen,
  });
}

// ─── Qué hacer con cada respuesta de Twilio ────────────────────────────────

interface Intento {
  e: Candidato;
  intentos: number;
  segmentosEstimados: number;
}

type Manejadores = {
  [T in ResultadoTwilio["tipo"]]: (c: Corrida, i: Intento, r: Extract<ResultadoTwilio, { tipo: T }>) => Promise<void>;
};

const MANEJADORES: Manejadores = {
  async aceptado(c, { e, segmentosEstimados }, r) {
    const segmentos = r.segmentos ?? segmentosEstimados;
    const cerrado = await c.cerrar(e, {
      estado: "aceptado",
      sid: r.sid,
      segmentos,
      aceptadoEn: c.ahora,
      codigoProveedor: null,
      motivoNoEnvio: null,
    });
    c.resumen.aceptados += 1;
    if (cerrado) {
      c.evento("aceptado", e, `sid=${r.sid} segmentos=${segmentos}`);
      return;
    }
    // Salió, y el turno se cerró en el medio. La fila queda cancelada pero
    // con la evidencia: alguien tiene que llamar.
    await c.prisma.envioSms.updateMany({
      where: { id: e.id, estado: "cancelado" },
      data: { sid: r.sid, segmentos, aceptadoEn: c.ahora, motivoNoEnvio: MENSAJE_ENVIADO_TRAS_CANCELACION },
    });
    c.resumen.aceptadosTrasCancelacion += 1;
    c.resumen.alertas.push({
      nivel: "aviso",
      titulo: "Un SMS salió con el turno ya cerrado: hay que avisarle a la paciente",
      detalle: { envioId: e.id, turnoId: e.turnoId, sid: r.sid },
    });
    c.evento("aceptado-tras-cancelacion", e, `sid=${r.sid}`);
  },

  async transitorio(c, { e, intentos }, r) {
    const decision = decidirTrasFalloTransitorio({
      intentos,
      ahora: c.ahora,
      limiteUtil: limiteUtilDe(e),
      fechaTurno: e.turno?.fecha ?? null,
      aleatorio: c.aleatorio(),
      jitterMayor: r.clasificacion.jitterMayor,
    });
    const codigo = aCodigo(r.codigo);
    if (decision.accion === "reintentar") {
      await c.cerrar(e, { estado: "pendiente", proximoIntentoEn: decision.proximoIntentoEn, codigoProveedor: codigo });
      c.resumen.reintentos += 1;
      c.evento("reintento", e, `codigo=${codigo ?? "-"} proximo=${decision.proximoIntentoEn.toISOString()} error="${r.mensaje}"`);
    } else if (decision.accion === "fallido") {
      await c.cerrar(e, { estado: "fallido", codigoProveedor: codigo, motivoNoEnvio: decision.motivo, cerradoEn: c.ahora });
      c.resumen.fallidos += 1;
      c.evento("fallido", e, `codigo=${codigo ?? "-"} error="${r.mensaje}"`);
    } else {
      await c.cerrar(e, { estado: "cancelado", codigoProveedor: codigo, motivoNoEnvio: decision.motivo, cerradoEn: c.ahora });
      c.resumen.cancelados += 1;
      c.evento("cancelado", e, `motivo="${decision.motivo}"`);
    }
    if (r.clasificacion.alerta) {
      c.resumen.alertas.push({
        nivel: r.clasificacion.alerta,
        titulo: `El servicio de SMS no puede mandar: ${r.mensaje}`,
        detalle: { codigo, httpStatus: r.httpStatus, referencia: r.clasificacion.referencia },
      });
    }
  },

  async definitivo(c, { e }, r) {
    const codigo = aCodigo(r.codigo);
    await c.cerrar(e, {
      estado: "fallido",
      codigoProveedor: codigo,
      motivoNoEnvio: r.clasificacion.motivoNoEnvio ?? SMS_MOTIVOS.RECHAZADO,
      cerradoEn: c.ahora,
    });
    c.resumen.fallidos += 1;
    c.evento("fallido", e, `codigo=${codigo ?? "-"} error="${r.mensaje}"`);
    if (r.clasificacion.baja) {
      await c.prisma.bajaSms.upsert({
        where: { telefono: e.destino },
        update: {},
        create: { telefono: e.destino, motivo: r.clasificacion.baja },
      });
      await cancelarPendientesDelDestino(c.prisma, e.destino, MOTIVO_BAJA, c.ahora, e.id);
    }
    if (r.clasificacion.alerta) {
      c.resumen.alertas.push({
        nivel: r.clasificacion.alerta,
        titulo: `El servicio de SMS rechazó un envío por configuración: ${r.mensaje}`,
        detalle: { codigo, httpStatus: r.httpStatus, referencia: r.clasificacion.referencia },
      });
    }
  },

  async desconocido(c, { e }, r) {
    await c.cerrar(e, { estado: "desconocido", motivoNoEnvio: r.motivo });
    c.resumen.desconocidos += 1;
    c.evento("desconocido", e, `motivo="${r.motivo}"`);
  },
};

function manejar(c: Corrida, i: Intento, r: ResultadoTwilio): Promise<void> {
  // TypeScript no correlaciona la clave con el tipo del resultado: el mapa sí.
  return (MANEJADORES[r.tipo] as (c: Corrida, i: Intento, r: ResultadoTwilio) => Promise<void>)(c, i, r);
}

/** Un envío, de la reserva al cierre. */
async function procesar(c: Corrida, e: Candidato, corteRescate: Date, ts: string): Promise<void> {
  const { prisma, ahora, resumen } = c;
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
    c.evento("skip", e, "resultado=tomado-por-otra-corrida");
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
        await c.cerrar(e, { estado: "desconocido", motivoNoEnvio: MOTIVO_RESERVA_HUERFANA });
        resumen.desconocidos += 1;
        c.evento("rescate", e, "resultado=desconocido-llamada-pudo-salir");
        return;
      }
      c.evento("rescate", e, "resultado=reserva-huerfana-sin-llamada");
    }

    const corte = await cortePrevio(c, e);
    if (corte) {
      await c.cerrar(e, { estado: "cancelado", motivoNoEnvio: corte.motivo, cerradoEn: ahora });
      resumen.cancelados += 1;
      c.evento(corte.evento, e, "resultado=cancelado");
      return;
    }

    const texto = await textoDe(c, e);
    if (!texto) {
      await c.cerrar(e, { estado: "cancelado", motivoNoEnvio: MOTIVO_SIN_TEXTO_DE_COBRO, cerradoEn: ahora });
      resumen.cancelados += 1;
      c.evento("sin-deuda", e, "resultado=cancelado");
      return;
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
      resultado = await c.enviar({ destino: e.destino, texto, statusCallback: URL_CALLBACK });
    } catch (error) {
      // El enviador no lanza; si algo lo hace, no sabemos si el cuerpo
      // viajó. Desconocido, por prudencia.
      const msg = error instanceof Error ? error.message : String(error);
      resultado = { tipo: "desconocido", motivo: `el enviador lanzó: ${msg.slice(0, 120)}` };
    }

    await manejar(c, { e, intentos, segmentosEstimados }, resultado);
  } catch (error) {
    // Un error nuestro (sin configuración, la base) antes o después de
    // Twilio. Si el intento no se consumió, la llamada no salió: se
    // reintenta con backoff. Si se consumió y llegamos acá, es que falló
    // la persistencia del resultado: la fila queda en `enviando` y el
    // rescate la va a pasar a desconocido (proximoIntentoEn es null).
    const msg = error instanceof Error ? error.message : String(error);
    if (!intentoConsumido) {
      try {
        const decision = decidirTrasFalloTransitorio({
          intentos: Math.max(1, intentos),
          ahora,
          limiteUtil: limiteUtilDe(e),
          fechaTurno: e.turno?.fecha ?? null,
          aleatorio: c.aleatorio(),
        });
        if (decision.accion === "reintentar") {
          await c.cerrar(e, { estado: "pendiente", proximoIntentoEn: decision.proximoIntentoEn, motivoNoEnvio: msg.slice(0, 200) });
          resumen.reintentos += 1;
        } else {
          await c.cerrar(e, { estado: decision.accion, motivoNoEnvio: decision.motivo, cerradoEn: ahora });
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
    c.evento("error", e, `error="${msg}"`);
  }
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

  const corrida: Corrida = {
    prisma,
    ahora,
    resumen,
    aleatorio,
    textoDeCobro,
    enviar,
    evento: (tipo, e, resto = "") => {
      resumen.eventos.push(
        `[sms][${tipo}] envio=${e.id} turno=${e.turnoId ?? "-"} motivo=${e.motivo} intentos=${e.intentos}${resto ? ` ${resto}` : ""} ts=${ts}`,
      );
    },
    cerrar: async (e, data) => {
      const { count } = await prisma.envioSms.updateMany({ where: { id: e.id, estado: "enviando" }, data });
      return count > 0;
    },
  };

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
      await procesar(corrida, candidatos[i], corteRescate, ts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, candidatos.length) }, trabajador));

  if (cortadoPorDeadline && siguiente < candidatos.length) resumen.hayMas = true;
  return resumen;
}
