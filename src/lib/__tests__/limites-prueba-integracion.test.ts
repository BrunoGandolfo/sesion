/**
 * Integración — el tope de grabaciones de un consultorio creado por invitación.
 * Contra la base de test (DATABASE_URL_TEST).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { prepararAudio } from "@/app/api/_lib/casos-uso/audio";
import { cobrarTurno } from "@/app/api/_lib/casos-uso/cobrar-turno";
import { crearTurno } from "@/app/api/_lib/casos-uso/crear-turno";
import { leerEstadoPrueba } from "@/app/api/_lib/casos-uso/estado-prueba";
import { crearPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { PRUEBA_TOPE } from "@/lib/glosario";
import { TOPE_GRABACIONES_PRUEBA } from "@/lib/limites-prueba";
import { cifrarConsentimiento } from "@/lib/prisma-encryption";

import { vaciarTablas } from "./db-test";
import { conectarArea2 } from "./estados-fixtures";

let base: ReturnType<typeof conectarArea2>;
beforeAll(() => { base = conectarArea2(); });
afterAll(async () => base.prisma.$disconnect());
beforeEach(async () => { await vaciarTablas(base.prisma); });

const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function consultorio(deInvitacion: boolean) {
  const organizationId = (await base.prisma.organization.create({ data: { nombre: "Consultorio", deInvitacion } })).id;
  const pacienteId = (await base.prisma.paciente.create({ data: { organizationId, nombre: "Prueba", apellido: "Sintética", telefono: "", tarifa: 100 } })).id;
  const id = crypto.randomUUID();
  await base.prisma.consentimientoGrabacion.create({ data: { ...cifrarConsentimiento(id, { textoCompleto: "Prueba", firmaDigital: "Prueba" }), organizationId, pacienteId, textoVersion: "2.4", firmadoEn: ayer } });
  return { organizationId, pacienteId };
}

let minuto = 0;
async function turno(organizationId: string, pacienteId: string) {
  minuto += 60;
  return (await base.prisma.turno.create({ data: { organizationId, pacienteId, fecha: new Date(ayer.getTime() + minuto * 60_000), tarifaCobrada: 100 } })).id;
}

async function grabar(organizationId: string, pacienteId: string) {
  return prepararAudio({ prisma: base.db, organizationId, turnoId: await turno(organizationId, pacienteId) });
}

test("el grabador crea la sesión por POST /api/sesion-clinica, que pasa por el contador de prepararAudio", () => {
  const codigo = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
  // La pantalla restaurada y el hook no tienen otro camino para crear la sesión.
  expect(codigo("src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx")).toContain('apiPost<SesionApi>("/api/sesion-clinica"');
  expect(codigo("src/hooks/useGrabacionSesion.ts")).toContain('fetch("/api/sesion-clinica"');
  // La ruta delega en prepararAudio, y prepararAudio es quien cuenta.
  const ruta = codigo("src/app/api/sesion-clinica/route.ts");
  expect(ruta).toMatch(/export async function POST[\s\S]*await prepararAudio\(\{ prisma: db, organizationId, turnoId \}\)/);
  const casoDeUso = codigo("src/app/api/_lib/casos-uso/audio.ts");
  const preparar = casoDeUso.slice(casoDeUso.indexOf("export async function prepararAudio("), casoDeUso.indexOf("export async function pedirUrlSubida("));
  expect(preparar).toContain("grabacionesIniciadas: { lt: TOPE_GRABACIONES_PRUEBA }");
  expect(preparar).toContain("grabacionesIniciadas: { increment: 1 }");
  expect(preparar).toContain("throw new ApiError(PRUEBA_TOPE, 403)");
});

test(`un consultorio invitado graba ${TOPE_GRABACIONES_PRUEBA} y no puede iniciar la siguiente; el rechazo lo explica`, async () => {
  const { organizationId, pacienteId } = await consultorio(true);
  const grabadas = [];
  for (let i = 0; i < TOPE_GRABACIONES_PRUEBA; i++) grabadas.push(await grabar(organizationId, pacienteId));
  expect(await leerEstadoPrueba({ prisma: base.db, organizationId })).toEqual({ usadas: 15, restantes: 0, tope: 15 });

  const turnoDieciseis = await turno(organizationId, pacienteId);
  await expect(prepararAudio({ prisma: base.db, organizationId, turnoId: turnoDieciseis })).rejects.toMatchObject({ status: 403, message: PRUEBA_TOPE });
  expect(PRUEBA_TOPE).toContain("hablá con quien te invitó");
  expect(await base.prisma.sesionClinica.count({ where: { organizationId } })).toBe(15);

  // Reanudar una grabación ya iniciada no es una nueva: sigue andando y no suma.
  const turnoDeLaPrimera = (await base.prisma.sesionClinica.findUniqueOrThrow({ where: { id: grabadas[0].id } })).turnoId;
  expect(await prepararAudio({ prisma: base.db, organizationId, turnoId: turnoDeLaPrimera })).toEqual({ id: grabadas[0].id });
  expect((await base.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).grabacionesIniciadas).toBe(15);
});

test("eliminar una sesión fallida no devuelve el cupo", async () => {
  const { organizationId, pacienteId } = await consultorio(true);
  await base.prisma.organization.update({ where: { id: organizationId }, data: { grabacionesIniciadas: TOPE_GRABACIONES_PRUEBA - 1 } });
  const { id } = await grabar(organizationId, pacienteId);
  await base.prisma.sesionClinica.delete({ where: { id } });
  await expect(grabar(organizationId, pacienteId)).rejects.toMatchObject({ status: 403 });
});

test("dos inicios a la vez con una sola grabación restante: pasa uno", async () => {
  const { organizationId, pacienteId } = await consultorio(true);
  await base.prisma.organization.update({ where: { id: organizationId }, data: { grabacionesIniciadas: TOPE_GRABACIONES_PRUEBA - 1 } });
  const resultados = await Promise.allSettled([grabar(organizationId, pacienteId), grabar(organizationId, pacienteId)]);
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((resultados.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 403 });
  expect(await base.prisma.sesionClinica.count({ where: { organizationId } })).toBe(1);
});

test("en el tope, lo demás del consultorio invitado sigue sin límite: pacientes, agenda y cobros", async () => {
  const { organizationId } = await consultorio(true);
  await base.prisma.organization.update({ where: { id: organizationId }, data: { grabacionesIniciadas: TOPE_GRABACIONES_PRUEBA } });
  const paciente = await crearPaciente({ prisma: base.db, organizationId, datos: { nombre: "Nueva", apellido: "Paciente", telefono: "", tarifa: 1000, notas: null } });
  const { id: turnoId } = await crearTurno({ prisma: base.db, organizationId, pacienteId: paciente.id, fecha: new Date(Date.now() - 3 * 60 * 60 * 1000), duracion: 50, modalidad: "presencial", notas: null, frecuencia: "unico", ahora: new Date() });
  expect((await cobrarTurno({ prisma: base.db, organizationId, turnoId, metodo: "efectivo", fecha: new Date() })).pagoEstado).toBe("pagado");
});

test("la cuenta de quien invita no tiene tope: graba aunque su contador pase de quince", async () => {
  const { organizationId, pacienteId } = await consultorio(false);
  await base.prisma.organization.update({ where: { id: organizationId }, data: { grabacionesIniciadas: 100 } });
  await expect(grabar(organizationId, pacienteId)).resolves.toMatchObject({ id: expect.any(String) });
  expect(await leerEstadoPrueba({ prisma: base.db, organizationId })).toBeNull();
});
