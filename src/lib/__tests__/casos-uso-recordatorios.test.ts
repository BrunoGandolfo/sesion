/**
 * Integración — enviarRecordatoriosVencidos contra la DB real de test
 * (DATABASE_URL_TEST). Twilio no interviene: el envío es un stub inyectado.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/casos-uso-recordatorios.test.ts
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  enviarRecordatoriosVencidos,
  MENSAJE_ENVIADO_TRAS_CANCELACION,
  MENSAJE_INTENTOS_AGOTADOS,
  type EnviarSms,
} from "@/app/api/_lib/casos-uso/enviar-recordatorios";
import { __resetKeyCacheForTests } from "@/lib/encryption";
import { asegurarLineaContacto, buildSmsMessage } from "@/lib/sms-texto";

import {
  conectarBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

// Instante UTC explícito (12:00 de Montevideo del 3/9/2026). Con
// `new Date(2026, 8, 3, 12)` la referencia cambiaba con la zona del proceso.
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const MAX_INTENTOS = 3;
const TEMPLATE = "Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}.";
const CONFIG = {
  nombreProfesional: "Mariana Roldán",
  direccion: "Rivera 2540",
  whatsappOrigen: "+598 99 876 543",
};

type Fixture = { recordatorioId: string; fechaTurno: Date };

/** Org con configuración, paciente, turno y un recordatorio pendiente cuya
 *  hora ya llegó. Por defecto el turno es futuro (mañana). */
async function crearRecordatorio(opciones: {
  fechaTurno?: Date;
  estadoTurno?: string;
  intentos?: number;
  estado?: string;
} = {}): Promise<Fixture> {
  const fechaTurno =
    opciones.fechaTurno ?? new Date(AHORA.getTime() + 24 * 60 * 60000);
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  await prismaRaw.configuracion.create({
    data: {
      organizationId: org.id,
      tarifaDefault: 1000,
      templateRecordatorio: TEMPLATE,
      ...CONFIG,
    },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Lucía",
      apellido: "Gómez",
      telefono: "+59899123456",
      tarifa: 1000,
      organizationId: org.id,
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: fechaTurno,
      estado: opciones.estadoTurno ?? "programado",
      tarifaCobrada: 1000,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  const recordatorio = await prismaRaw.recordatorio.create({
    data: {
      turnoId: turno.id,
      estado: opciones.estado ?? "pendiente",
      intentos: opciones.intentos ?? 0,
      programadoEn: new Date(AHORA.getTime() - 60000),
    },
  });
  return { recordatorioId: recordatorio.id, fechaTurno };
}

async function leer(id: string) {
  return prismaRaw.recordatorio.findUniqueOrThrow({ where: { id } });
}

function textoEsperado(fechaTurno: Date): string {
  return buildSmsMessage(asegurarLineaContacto(TEMPLATE), {
    nombre: "Lucía",
    apellido: "Gómez",
    fecha: fechaTurno,
    direccion: CONFIG.direccion,
    profesional: CONFIG.nombreProfesional,
    telefonoConsultorio: CONFIG.whatsappOrigen,
  });
}

function correr(
  enviarSms: EnviarSms,
  ahora: Date = AHORA,
  extra: { tope?: number; rescateMs?: number } = {},
) {
  return enviarRecordatoriosVencidos({
    prisma: db,
    ahora,
    enviarSms,
    maxIntentos: MAX_INTENTOS,
    ...extra,
  });
}

/** Retrasa `actualizado_en` para simular una reserva que quedó huérfana.
 *  La columna es @updatedAt: Prisma la maneja, así que se toca por SQL. */
async function envejecerReserva(id: string, cuando: Date) {
  await prismaRaw.$executeRaw`
    UPDATE recordatorios SET actualizado_en = ${cuando} WHERE id = ${id}
  `;
}

const enviaOk: EnviarSms = async () => ({ success: true, sid: "SM1" });
const lanza: EnviarSms = async () => {
  throw new Error("Twilio caído");
};

beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
  __resetKeyCacheForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.NOTES_ENCRYPTION_KEY;
  } else {
    process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  __resetKeyCacheForTests();
});

describe("enviarRecordatoriosVencidos", () => {
  it("con envío exitoso pasa a enviado y guarda el texto exacto", async () => {
    const { recordatorioId, fechaTurno } = await crearRecordatorio();
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(resumen).toMatchObject({
      procesados: 1,
      enviados: 1,
      fallidos: 0,
      saltados: 0,
      vencidos: 0,
      errores: [],
      fallosPersistencia: [],
    });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub.mock.calls[0][0]).toEqual({
      to: "+59899123456",
      text: textoEsperado(fechaTurno),
    });

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("enviado");
    expect(fila.textoEnviado).toBe(textoEsperado(fechaTurno));
    expect(fila.textoEnviado).toContain("Lucía");
    expect(fila.enviadoEn?.getTime()).toBe(AHORA.getTime());
    expect(fila.intentos).toBe(1);
    expect(fila.error).toBeNull();
  });

  it("con envío que lanza queda pendiente con intentos+1 y el error", async () => {
    const { recordatorioId } = await crearRecordatorio();

    const resumen = await correr(lanza);

    expect(resumen.fallidos).toBe(1);
    expect(resumen.enviados).toBe(0);
    expect(resumen.errores).toEqual([
      `Recordatorio ${recordatorioId}: Twilio caído`,
    ]);

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("pendiente");
    expect(fila.intentos).toBe(1);
    expect(fila.error).toBe("Twilio caído");
    expect(fila.textoEnviado).toBeNull();
  });

  it("con envío que devuelve success:false también cuenta como fallo", async () => {
    const { recordatorioId } = await crearRecordatorio();
    const rechaza: EnviarSms = async () => ({
      success: false,
      error: "Twilio 21211: Invalid 'To'",
    });

    await correr(rechaza);

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("pendiente");
    expect(fila.error).toBe("Twilio 21211: Invalid 'To'");
  });

  it("al alcanzar maxIntentos pasa a fallido y no se vuelve a intentar", async () => {
    const { recordatorioId } = await crearRecordatorio({
      intentos: MAX_INTENTOS - 1,
    });

    const primera = await correr(lanza);
    expect(primera.fallidos).toBe(1);
    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("fallido");
    expect(fila.intentos).toBe(MAX_INTENTOS);

    const stub = vi.fn(enviaOk);
    const segunda = await correr(stub);
    expect(segunda.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(recordatorioId)).estado).toBe("fallido");
  });

  it("un recordatorio cuyo turno ya pasó se marca vencido sin enviar", async () => {
    const { recordatorioId } = await crearRecordatorio({
      fechaTurno: new Date(AHORA.getTime() - 60 * 60000),
    });
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(resumen.vencidos).toBe(1);
    expect(resumen.enviados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("cancelado");
    expect(fila.error).toBe("vencido");
  });

  it("un turno cancelado se cierra con motivo turno_cancelado sin enviar", async () => {
    const { recordatorioId } = await crearRecordatorio({
      estadoTurno: "cancelado",
    });
    const stub = vi.fn(enviaOk);

    await correr(stub);

    expect(stub).not.toHaveBeenCalled();
    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("cancelado");
    expect(fila.error).toBe("turno_cancelado");
  });

  it("dos corridas seguidas con el mismo ahora no envían dos veces el mismo recordatorio", async () => {
    const { recordatorioId } = await crearRecordatorio();
    const stub = vi.fn(enviaOk);

    const primera = await correr(stub);
    const segunda = await correr(stub);

    expect(primera.enviados).toBe(1);
    expect(segunda.enviados).toBe(0);
    expect(segunda.procesados).toBe(0);
    expect(stub).toHaveBeenCalledTimes(1);
    expect((await leer(recordatorioId)).intentos).toBe(1);
  });

  // ─── Reservar no es intentar ────────────────────────────────────────────
  // Lo que protege este bloque: un corte de la función serverless entre la
  // reserva y la llamada a Twilio no puede gastar un intento.

  it("cuando Twilio recibe la llamada la fila ya está reservada y el intento contado", async () => {
    const { recordatorioId } = await crearRecordatorio();
    const vistas: { estado: string; intentos: number }[] = [];

    // El stub mira la fila desde adentro del envío: ese es el único momento
    // en que se puede comprobar el orden reserva → intento → llamada.
    await correr(async () => {
      const fila = await leer(recordatorioId);
      vistas.push({ estado: fila.estado, intentos: fila.intentos });
      return { success: true, sid: "SM1" };
    });

    expect(vistas).toEqual([{ estado: "enviando", intentos: 1 }]);
  });

  it("una reserva huérfana se rescata sin gastar un intento", async () => {
    // Así queda la fila cuando la función se corta después de reservar:
    // "enviando", intentos en 0, y sin nadie trabajándola.
    const { recordatorioId } = await crearRecordatorio({ estado: "enviando" });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(resumen.rescatados).toBe(1);
    expect(resumen.enviados).toBe(1);
    expect(stub).toHaveBeenCalledTimes(1);

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("enviado");
    // Uno solo: el del envío que sí ocurrió. El corte no gastó nada.
    expect(fila.intentos).toBe(1);
  });

  it("el rescate no suma un intento propio: el que cuenta es el de Twilio", async () => {
    const { recordatorioId } = await crearRecordatorio({ estado: "enviando" });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));

    // Rescate + envío que falla: un solo intento gastado, el de la llamada.
    await correr(lanza);

    const fila = await leer(recordatorioId);
    expect(fila.intentos).toBe(1);
    expect(fila.estado).toBe("pendiente");
    expect(fila.error).toBe("Twilio caído");
  });

  it("la reserva huérfana de un recordatorio ya agotado no revive el envío", async () => {
    const { recordatorioId } = await crearRecordatorio({
      estado: "enviando",
      intentos: MAX_INTENTOS - 1,
    });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));

    await correr(lanza);

    const fila = await leer(recordatorioId);
    expect(fila.intentos).toBe(MAX_INTENTOS);
    expect(fila.estado).toBe("fallido");
  });

  // ─── Reserva huérfana con los intentos agotados ─────────────────────────
  // El borde exacto es `intentos === maxIntentos`. Así queda la fila cuando
  // la corrida se muere DESPUÉS de gastar el último intento y ANTES de
  // cerrarla: sin la guarda, el rescate le sumaba uno más y mandaba el
  // cuarto SMS de tres — y si el corte se repite, sigue mandando para
  // siempre.

  it("con intentos === maxIntentos la reserva huérfana se cierra fallida sin llamar a Twilio", async () => {
    const { recordatorioId } = await crearRecordatorio({
      estado: "enviando",
      intentos: MAX_INTENTOS,
    });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(stub).not.toHaveBeenCalled();
    expect(resumen.rescatados).toBe(1);
    expect(resumen.fallidos).toBe(1);
    expect(resumen.enviados).toBe(0);
    expect(resumen.errores).toEqual([
      `Recordatorio ${recordatorioId}: ${MENSAJE_INTENTOS_AGOTADOS}`,
    ]);

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("fallido");
    // Ni uno más: no hubo llamada, así que no hay intento que contar.
    expect(fila.intentos).toBe(MAX_INTENTOS);
    expect(fila.error).toBe(MENSAJE_INTENTOS_AGOTADOS);
  });

  it("con un intento todavía disponible el rescate sí envía", async () => {
    // El otro lado del borde: maxIntentos - 1 no está agotado.
    const { recordatorioId } = await crearRecordatorio({
      estado: "enviando",
      intentos: MAX_INTENTOS - 1,
    });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(stub).toHaveBeenCalledTimes(1);
    expect(resumen.enviados).toBe(1);
    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("enviado");
    expect(fila.intentos).toBe(MAX_INTENTOS);
  });

  it("por más corridas que pasen, un recordatorio agotado no manda otro SMS", async () => {
    const { recordatorioId } = await crearRecordatorio({
      estado: "enviando",
      intentos: MAX_INTENTOS,
    });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 10 * 60_000));
    const stub = vi.fn(enviaOk);

    await correr(stub);
    // La fila quedó en "fallido": la segunda corrida ni siquiera la levanta.
    const segunda = await correr(stub);

    expect(stub).not.toHaveBeenCalled();
    expect(segunda.procesados).toBe(0);
    expect((await leer(recordatorioId)).estado).toBe("fallido");
  });

  it("una reserva reciente no se toca: la otra corrida sigue viva", async () => {
    const { recordatorioId } = await crearRecordatorio({ estado: "enviando" });
    await envejecerReserva(recordatorioId, new Date(AHORA.getTime() - 30_000));
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(resumen.procesados).toBe(0);
    expect(resumen.rescatados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(recordatorioId)).estado).toBe("enviando");
  });

  it("un error anterior a Twilio sí gasta el intento", async () => {
    // Organización sin configuración: falla determinista, no corte.
    const { recordatorioId } = await crearRecordatorio();
    const fila = await leer(recordatorioId);
    const turno = await prismaRaw.turno.findUniqueOrThrow({
      where: { id: fila.turnoId },
    });
    await prismaRaw.configuracion.delete({
      where: { organizationId: turno.organizationId },
    });
    const stub = vi.fn(enviaOk);

    await correr(stub);

    expect(stub).not.toHaveBeenCalled();
    const despues = await leer(recordatorioId);
    expect(despues.intentos).toBe(1);
    expect(despues.estado).toBe("pendiente");
    expect(despues.error).toContain("sin configuración");
  });

  // ─── Tope por corrida ───────────────────────────────────────────────────

  it("el tope acota la corrida y avisa que quedaron recordatorios", async () => {
    await crearRecordatorio();
    await crearRecordatorio();
    const stub = vi.fn(enviaOk);

    const primera = await correr(stub, AHORA, { tope: 1 });

    expect(primera.procesados).toBe(1);
    expect(primera.enviados).toBe(1);
    expect(primera.hayMas).toBe(true);

    const segunda = await correr(stub, AHORA, { tope: 1 });
    expect(segunda.enviados).toBe(1);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("un recordatorio programado para más adelante no se toca", async () => {
    const { recordatorioId } = await crearRecordatorio();
    await prismaRaw.recordatorio.update({
      where: { id: recordatorioId },
      data: { programadoEn: new Date(AHORA.getTime() + 60000) },
    });
    const stub = vi.fn(enviaOk);

    const resumen = await correr(stub);

    expect(resumen.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(recordatorioId)).estado).toBe("pendiente");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A4 — los cierres del envío no pisan una cancelación escrita en el medio.
//
// La carrera: la corrida reserva el recordatorio ("enviando"), llama a
// Twilio, y MIENTRAS Twilio contesta la terapeuta cancela o reprograma el
// turno. Ese PATCH escribe "cancelado" en esta misma fila. Los cierres
// hacían `update` por id, sin mirar el estado, así que la pisaban:
//
//   - el cierre feliz la dejaba en "enviado" y la cancelación se perdía;
//   - el cierre por error la devolvía a "pendiente", o sea REVIVÍA un
//     recordatorio recién cancelado, con `programadoEn` viejo, para que el
//     próximo tick lo mandara en el acto. Era el agujero por el que se
//     escapaba el arreglo del PR #13 cada vez que Twilio fallaba.
//
// El stub de Twilio es el único lugar donde se puede meter la cancelación:
// es el instante en que la fila está reservada y la llamada en vuelo.
// ────────────────────────────────────────────────────────────────────────────

describe("cancelación del turno durante el envío", () => {
  /** Deja la fila como la dejaría el PATCH del turno: apagada. */
  async function cancelarDesdeAfuera(id: string) {
    await prismaRaw.recordatorio.updateMany({
      where: { id, estado: { in: ["pendiente", "enviando"] } },
      data: { estado: "cancelado" },
    });
  }

  it("si el SMS salió, la fila queda cancelada pero guarda la evidencia", async () => {
    const { recordatorioId, fechaTurno } = await crearRecordatorio();

    const resumen = await correr(async () => {
      await cancelarDesdeAfuera(recordatorioId);
      return { success: true, sid: "SM1" };
    });

    // El SMS salió: eso se cuenta.
    expect(resumen.enviados).toBe(1);
    expect(resumen.enviadosTrasCancelacion).toBe(1);

    // Y el aviso sale por su propio canal, para que el handler del cron no
    // tenga que reconocer un prefijo dentro de la bitácora para gritarlo.
    expect(resumen.avisosTrasCancelacion).toHaveLength(1);
    expect(resumen.avisosTrasCancelacion[0]).toContain(
      "[cron][enviado-tras-cancelacion]",
    );
    expect(resumen.avisosTrasCancelacion[0]).toContain(recordatorioId);
    // La misma línea sigue estando en la bitácora completa.
    expect(resumen.eventos).toContain(resumen.avisosTrasCancelacion[0]);

    const fila = await leer(recordatorioId);
    // Estado terminal: nadie lo vuelve a tomar, y "enviado" sería mentira
    // (el recordatorio no hizo su trabajo, avisó de algo que ya no existe).
    expect(fila.estado).toBe("cancelado");
    // Pero la evidencia queda: la paciente TIENE el mensaje en el teléfono.
    expect(fila.enviadoEn?.getTime()).toBe(AHORA.getTime());
    expect(fila.textoEnviado).toBe(textoEsperado(fechaTurno));
    expect(fila.error).toBe(MENSAJE_ENVIADO_TRAS_CANCELACION);
  });

  it("si el envío falló, el recordatorio NO revive", async () => {
    const { recordatorioId } = await crearRecordatorio();

    const resumen = await correr(async () => {
      await cancelarDesdeAfuera(recordatorioId);
      throw new Error("Twilio caído");
    });

    expect(resumen.fallidos).toBe(1);
    expect(resumen.enviados).toBe(0);

    const fila = await leer(recordatorioId);
    expect(fila.estado).toBe("cancelado");
    // Sin la guarda quedaba en "pendiente" y el tick siguiente lo mandaba.
    expect(fila.estado).not.toBe("pendiente");
  });

  it("y una corrida posterior no lo levanta", async () => {
    const { recordatorioId } = await crearRecordatorio();

    await correr(async () => {
      await cancelarDesdeAfuera(recordatorioId);
      throw new Error("Twilio caído");
    });

    const stub = vi.fn(enviaOk);
    const segunda = await correr(stub);

    expect(segunda.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(recordatorioId)).estado).toBe("cancelado");
  });

  it("sin cancelación en el medio, el cierre feliz sigue siendo 'enviado'", async () => {
    // El camino normal no cambió: la guarda sólo actúa cuando alguien más
    // tocó la fila.
    const { recordatorioId } = await crearRecordatorio();

    const resumen = await correr(vi.fn(enviaOk));

    expect(resumen.enviados).toBe(1);
    expect(resumen.enviadosTrasCancelacion).toBe(0);
    expect(resumen.avisosTrasCancelacion).toEqual([]);
    expect((await leer(recordatorioId)).estado).toBe("enviado");
  });
});
