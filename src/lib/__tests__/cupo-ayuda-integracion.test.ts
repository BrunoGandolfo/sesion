import { afterAll, beforeAll, expect, it } from "vitest";
import { reservarCupo, devolverCupo } from "@/app/api/_lib/casos-uso/ayuda/reservar-cupo";
import { conectarArea2, crearOrg, limpiarOrg, type BaseArea2, type Org } from "./estados-fixtures";
let base: BaseArea2;
let org: Org;
beforeAll(async () => {
  base = conectarArea2(); org = await crearOrg(base.prisma);
  await base.prisma.user.create({ data: { id: org.userId, organizationId: org.orgId, email: `${org.orgId}@test.local`, nombre: "Prueba", hashedPassword: "no-login" } });
});
afterAll(async () => { await base.prisma.user.delete({ where: { id: org.userId } }); await limpiarOrg(base.prisma, org.orgId); await base.prisma.$disconnect(); });

it("60 reservas simultáneas aceptan exactamente 40, con día de Montevideo como texto", async () => {
  const ahora = new Date("2026-09-08T01:00:00Z");
  const resultados = await Promise.allSettled(Array.from({ length: 60 }, () => reservarCupo(base.db, org.userId, ahora)));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(40);
  expect(resultados.filter(r => r.status === "rejected")).toHaveLength(20);
  for (const r of resultados) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 429 });
  expect(await base.prisma.cupoAyuda.findMany({ where: { userId: org.userId } })).toEqual([{ userId: org.userId, dia: "2026-09-07", usadas: 40 }]);
  await devolverCupo(base.db, { userId: org.userId, dia: "2026-09-07" });
  await expect(reservarCupo(base.db, org.userId, ahora)).resolves.toMatchObject({ dia: "2026-09-07" });
  await expect(reservarCupo(base.db, org.userId, ahora)).rejects.toMatchObject({ status: 429 });
  await expect(reservarCupo(base.db, org.userId, new Date("2026-09-08T03:00:00Z"))).resolves.toMatchObject({ dia: "2026-09-08" });
});
