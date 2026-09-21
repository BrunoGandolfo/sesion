import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { EstadoTrabajo } from "@prisma/client";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { conectarBaseDeTest, vaciarTablas } from "./db-test";
import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { enviarCorreo } from "@/lib/correo";
import { GET } from "@/app/api/cron/salud/route";

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
