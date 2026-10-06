import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoTrabajo } from "@prisma/client";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { conectarBaseDeTest, vaciarTablas } from "./db-test";
import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { enviarCorreo } from "@/lib/correo";
import { GET } from "@/app/api/cron/salud/route";
import { VENTANA_AVISO_REPETIDO_MS } from "@/app/api/_lib/casos-uso/salud";
import { cifrarHiloVersion } from "@/lib/prisma-encryption";

let base: ReturnType<typeof conectarBaseDeTest>;
let organizationId: string;
vi.mock("@/lib/db", () => ({ get db() { return base.db; } }));
vi.mock("@/app/api/_lib/auth", () => ({ requireCron: () => null }));
// Se ejecuta toda la cadena hasta el transporte de correo, sin enviar a nadie.
vi.mock("@/lib/correo", () => ({ enviarCorreo: vi.fn(async () => {}) }));
// La clave se pone ACÁ y no se hereda del ambiente: ver el comentario
// equivalente en revision-carreras.test.ts.
beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  base = conectarBaseDeTest();
});
afterAll(async () => { await base.prisma.$disconnect(); });
beforeEach(async () => {
  await vaciarTablas(base.prisma);
  vi.mocked(enviarCorreo).mockClear();
  vi.stubEnv("ALERTA_CORREO", "prueba@example.invalid");
  organizationId = (await base.prisma.organization.create({ data: { nombre: "Ficticia" } })).id;
  await base.prisma.workerEstado.create({ data: { id: "worker", workerId: "prueba", ultimoPollEn: new Date(), version: "test" } });
});
afterEach(() => vi.unstubAllEnvs());
async function trabajo(estado: EstadoTrabajo, edadHoras: number) {
  await base.prisma.trabajo.create({ data: {
    organizationId, tipo: "borrar_audio_r2", ejecutor: "app", estado,
    payload: {}, creadoEn: new Date(Date.now() - edadHoras * 3600000),
  } });
}
it.each<[EstadoTrabajo, number, string]>([
  ["fallido", 0, "trabajos_fallidos"],
  ["pendiente", 25, "trabajos_atrasados"],
  ["en_curso", 25, "trabajos_atrasados"],
])("con worker vivo alerta por %s de %s horas", async (estado, edad, nombre) => {
  await trabajo(estado, edad);
  const res = await GET(new Request("http://localhost/api/cron/salud"));
  const cuerpo = await res.json();
  expect(cuerpo.alertas).toEqual([nombre]);
  expect(cuerpo.alertaEnviada).toBe(true);
  expect(enviarCorreo).toHaveBeenCalledTimes(1);
  expect(vi.mocked(enviarCorreo).mock.calls[0][0].texto).toContain(nombre);
});
it("no avisa por tareas recientes ni terminadas", async () => {
  await trabajo("pendiente", 23);
  await trabajo("en_curso", 23);
  await trabajo("hecho", 48);
  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();
  expect(cuerpo.alertas).toEqual([]);
  expect(cuerpo.alertaEnviada).toBe(false);
  expect(enviarCorreo).not.toHaveBeenCalled();
});

// ────────────────────────────────────────────────────────────────────────────
// auditoria_rastros_perdidos_24h
//
// Los eventos informativos son best-effort: su fallo va a un console.error
// que nadie lee. No hace falta anotarlo en ningún lado para contarlo: los
// actos que dejan su propia marca de tiempo (creada_en, aprobada_en) tienen
// que tener su evento, y la diferencia son los rastros perdidos.
// ────────────────────────────────────────────────────────────────────────────

async function sesionConMarca(marca: "creadaEn" | "aprobadaEn", cuando: Date) {
  const paciente = await base.prisma.paciente.create({
    data: { nombre: "Ana", apellido: "X", telefono: `+5989${Math.floor(10000000 + Math.random() * 89999999)}`, tarifa: 1000, organizationId },
  });
  const turno = await base.prisma.turno.create({
    data: { fecha: cuando, estado: "realizado", tarifaCobrada: 1000, pacienteId: paciente.id, organizationId },
  });
  await base.prisma.sesionClinica.create({
    data: {
      turnoId: turno.id,
      organizationId,
      estado: marca === "aprobadaEn" ? "aprobada" : "grabando",
      // creadaEn tiene default(now()): las dos marcas se ponen explícitas
      // para que la ventana del test no dependa del reloj de la corrida.
      creadaEn: cuando,
      ...(marca === "aprobadaEn" ? { aprobadaEn: cuando } : {}),
    },
  });
}

async function evento(accion: string, cuando: Date) {
  await base.prisma.eventoAuditoria.create({
    data: { organizationId, actorTipo: "usuario", accion, entidad: "sesion_clinica", entidadId: "x", creadoEn: cuando },
  });
}

const haceHoras = (h: number) => new Date(Date.now() - h * 3600000);

it("avisa cuando un acto de las últimas 24 h se quedó sin su evento", async () => {
  // Dos sesiones creadas; sólo una dejó rastro.
  await sesionConMarca("creadaEn", haceHoras(3));
  await sesionConMarca("creadaEn", haceHoras(2));
  await evento("sesion.crear", haceHoras(3));

  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();

  expect(cuerpo.alertas).toEqual(["auditoria_rastros_perdidos_24h"]);
  const texto = vi.mocked(enviarCorreo).mock.calls[0][0].texto;
  expect(texto).toContain("sesion.crear: 1");
  expect(texto).toContain("[auditoria] fallo");
});

it("suma los dos pares: crear y aprobar", async () => {
  await sesionConMarca("creadaEn", haceHoras(5));
  await sesionConMarca("aprobadaEn", haceHoras(4));
  // Ni uno ni otro dejaron evento: la sesión aprobada cuenta en los dos
  // pares, porque también fue creada.
  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();
  const metrica = cuerpo.metricas.find((m: { nombre: string }) => m.nombre === "auditoria_rastros_perdidos_24h");
  expect(metrica.valor).toBe(3);
});

it("con cada acto y su evento en su lugar, no avisa nada", async () => {
  await sesionConMarca("creadaEn", haceHoras(6));
  await evento("sesion.crear", haceHoras(6));
  await sesionConMarca("aprobadaEn", haceHoras(6));
  await evento("sesion.crear", haceHoras(6));
  await evento("sesion.aprobar", haceHoras(6));

  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();
  expect(cuerpo.alertas).toEqual([]);
  expect(enviarCorreo).not.toHaveBeenCalled();
});

it("no mira más allá de la ventana ni lo recién ocurrido", async () => {
  // Fuera de las 24 h: no se cuenta aunque no tenga evento.
  await sesionConMarca("creadaEn", haceHoras(30));
  // Recién ocurrido: su evento puede estar escribiéndose todavía.
  await sesionConMarca("creadaEn", new Date());

  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();
  expect(cuerpo.alertas).toEqual([]);
});

it("más eventos que actos no inventa una alarma negativa", async () => {
  // La sesión se creó y después se eliminó: su evento quedó (append-only).
  await evento("sesion.crear", haceHoras(2));
  await evento("sesion.aprobar", haceHoras(2));

  const cuerpo = await (await GET(new Request("http://localhost/api/cron/salud"))).json();
  const metrica = cuerpo.metricas.find((m: { nombre: string }) => m.nombre === "auditoria_rastros_perdidos_24h");
  expect(metrica.valor).toBe(0);
  expect(cuerpo.alertas).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// integrar_contexto que espera a la profesional
//
// La regla de encadenado (trabajos/reclamar.ts) no entrega una integración
// mientras la paciente tenga una propuesta del Recorrido sin resolver. Ese
// trabajo no está atrasado: espera. El 29-sep dos de estos mandaron un correo
// por hora durante un día.
// ────────────────────────────────────────────────────────────────────────────

async function pacienteConIntegracionVieja(opciones: { propuestaAbierta: boolean }) {
  const paciente = await base.prisma.paciente.create({
    data: { nombre: "Ana", apellido: "X", telefono: "+59899000001", tarifa: 1000, organizationId },
  });
  if (opciones.propuestaAbierta) {
    await base.db.hilo.create({ data: { pacienteId: paciente.id, organizationId } });
    await base.db.hiloVersion.create({ data: {
      ...cifrarHiloVersion(crypto.randomUUID(), { contenido: { resumen: "propuesta" } }),
      pacienteId: paciente.id, organizationId, version: 1, actor: "ia", estado: "propuesta",
    } });
  }
  await base.prisma.trabajo.create({ data: {
    organizationId, pacienteId: paciente.id, tipo: "integrar_contexto", ejecutor: "worker", estado: "pendiente",
    payload: {}, creadoEn: new Date(Date.now() - 30 * 3600000),
  } });
}

const correr = async (ahora?: Date) => {
  if (ahora) {
    vi.setSystemTime(ahora);
    // El worker sigue vivo a esa hora: si no, su monitor cambia el aviso.
    await base.prisma.workerEstado.update({ where: { id: "worker" }, data: { ultimoPollEn: ahora } });
  }
  return (await GET(new Request("http://localhost/api/cron/salud"))).json();
};

it("una integrar_contexto bloqueada por una propuesta abierta no cuenta como atrasada", async () => {
  await pacienteConIntegracionVieja({ propuestaAbierta: true });
  const cuerpo = await correr();
  expect(cuerpo.metricas.find((m: { nombre: string }) => m.nombre === "trabajos_atrasados").valor).toBe(0);
  expect(cuerpo.alertas).toEqual([]);
  expect(enviarCorreo).not.toHaveBeenCalled();
});

it("la misma integrar_contexto sin propuesta abierta sí está atrasada", async () => {
  await pacienteConIntegracionVieja({ propuestaAbierta: false });
  const cuerpo = await correr();
  expect(cuerpo.alertas).toEqual(["trabajos_atrasados"]);
});

it("detrás de otra integración vieja, la segunda espera y sólo cuenta la primera", async () => {
  await pacienteConIntegracionVieja({ propuestaAbierta: false });
  const [primera] = await base.prisma.trabajo.findMany();
  await base.prisma.trabajo.create({ data: {
    organizationId, pacienteId: primera.pacienteId, tipo: "integrar_contexto", ejecutor: "worker", estado: "pendiente",
    payload: {}, creadoEn: new Date(Date.now() - 26 * 3600000),
  } });
  const cuerpo = await correr();
  expect(cuerpo.metricas.find((m: { nombre: string }) => m.nombre === "trabajos_atrasados").valor).toBe(1);
});

// ────────────────────────────────────────────────────────────────────────────
// El mismo aviso no se repite cada hora
// ────────────────────────────────────────────────────────────────────────────

describe("aviso repetido", () => {
  const T0 = new Date("2026-10-06T12:00:00.000Z");
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  async function fallido() {
    await base.prisma.trabajo.create({ data: {
      organizationId, tipo: "borrar_audio_r2", ejecutor: "app", estado: "fallido", payload: {}, creadoEn: T0,
    } });
  }

  it("dos corridas seguidas con el mismo estado mandan un solo correo", async () => {
    await fallido();
    const primera = await correr(T0);
    const segunda = await correr(new Date(T0.getTime() + 3600000));

    expect(primera).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
    expect(segunda).toMatchObject({ alertas: ["trabajos_fallidos"], alertaEnviada: false, avisoRepetido: true });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    // La constancia: un evento del sistema, con la huella y sin texto.
    const [evento] = await base.prisma.eventoAuditoria.findMany({ where: { accion: "salud.aviso" } });
    expect(evento).toMatchObject({ actorTipo: "sistema", organizationId: "sistema", entidad: "salud", detalle: { nivel: "aviso", metricas: ["trabajos_fallidos"] } });
    expect(evento.entidadId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("si el contenido cambió, sale enseguida", async () => {
    await fallido();
    await correr(T0);
    await fallido(); // ahora son dos: otro número, otro aviso
    const segunda = await correr(new Date(T0.getTime() + 3600000));

    expect(segunda).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });

  it("pasadas 24 h el mismo aviso vuelve a salir una vez", async () => {
    await fallido();
    await correr(T0);
    await correr(new Date(T0.getTime() + VENTANA_AVISO_REPETIDO_MS - 60000));
    const despues = await correr(new Date(T0.getTime() + VENTANA_AVISO_REPETIDO_MS + 60000));

    expect(despues).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });

  it("si se resolvió y reaparece igual dentro de las 24 h, es otro incidente: avisa", async () => {
    await fallido();
    await correr(T0);
    await base.prisma.trabajo.updateMany({ data: { estado: "hecho" } });
    const sano = await correr(new Date(T0.getTime() + 3600000));
    await correr(new Date(T0.getTime() + 2 * 3600000));
    // La vuelta a la normalidad se anota una sola vez, no cada hora sana.
    expect(await base.prisma.eventoAuditoria.count({ where: { accion: "salud.normal" } })).toBe(1);
    await fallido();
    const otraVez = await correr(new Date(T0.getTime() + 3 * 3600000));

    expect(sano.alertas).toEqual([]);
    expect(otraVez).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });

  it("A → B → A: volver al primer estado también es un cambio, y avisa", async () => {
    await fallido();
    await correr(T0); // A: un fallido
    await fallido();
    await correr(new Date(T0.getTime() + 3600000)); // B: dos fallidos
    await base.prisma.trabajo.deleteMany({ where: { id: (await base.prisma.trabajo.findFirstOrThrow()).id } });
    const deVuelta = await correr(new Date(T0.getTime() + 2 * 3600000)); // A otra vez

    expect(deVuelta).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
    expect(enviarCorreo).toHaveBeenCalledTimes(3);
  });

  it("un correo que no salió no cuenta como enviado: la próxima corrida lo intenta", async () => {
    await fallido();
    vi.mocked(enviarCorreo).mockRejectedValue(new Error("Resend caído"));
    const primera = await correr(T0);
    vi.mocked(enviarCorreo).mockResolvedValue(undefined);
    const segunda = await correr(new Date(T0.getTime() + 3600000));

    expect(primera.alertaEnviada).toBe(false);
    expect(segunda).toMatchObject({ alertaEnviada: true, avisoRepetido: false });
  });
});
