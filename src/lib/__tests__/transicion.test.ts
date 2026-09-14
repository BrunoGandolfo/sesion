/**
 * Integración — toda transición escribe con el estado de partida en el WHERE
 * (S3): parametrizado sobre la tabla entera. Para cada operación por UPDATE,
 * una fila en un estado que NO es de partida recibe 409 y no cambia; una en
 * un estado de partida pasa al destino.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { transicionar } from "@/app/api/_lib/casos-uso/sesion/transicion";
import { ApiError } from "@/app/api/_lib/responses";
import { ESTADOS_SESION, LISTA_OPERACIONES } from "@/lib/sesion-clinica/estados";

import { conectarArea2, crearOrg, crearSesion, filaDe, limpiarOrg, type BaseArea2, type Org } from "./estados-fixtures";

let base!: BaseArea2;
let org!: Org;

beforeAll(async () => {
  base = conectarArea2();
  org = await crearOrg(base.prisma);
});

afterAll(async () => {
  await limpiarOrg(base.prisma, org.orgId);
  await base.prisma.$disconnect();
});

const POR_UPDATE = LISTA_OPERACIONES.filter((op) => op.desde.length > 0 && op.hacia !== "borrada");

describe.each(POR_UPDATE.map((op) => [op.nombre, op] as const))("%s", (nombre, op) => {
  const ajeno = ESTADOS_SESION.find((e) => !op.desde.includes(e))!;
  const intento = op.actor === "worker" ? 1 : undefined;

  it(`desde ${ajeno}: 409 y la fila no cambia`, async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: ajeno, intento: 1 });
    const antes = await filaDe(base.prisma, sesionId);
    await expect(
      transicionar({ prisma: base.db, operacion: nombre, sesionId, organizationId: org.orgId, intento }),
    ).rejects.toMatchObject({ status: 409 } satisfies Partial<ApiError>);
    const despues = await filaDe(base.prisma, sesionId);
    expect(despues).toEqual(antes);
  });

  it(`desde ${op.desde[0]}: pasa a ${op.hacia}`, async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: op.desde[0], intento: 1 });
    await transicionar({ prisma: base.db, operacion: nombre, sesionId, organizationId: org.orgId, intento });
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe(op.hacia === "mismo" ? op.desde[0] : op.hacia);
  });

  if (op.actor === "worker") {
    it("con un intento que no es el vigente: 409", async () => {
      const { sesionId } = await crearSesion(base.prisma, org, { estado: op.desde[0], intento: 2 });
      await expect(
        transicionar({ prisma: base.db, operacion: nombre, sesionId, organizationId: org.orgId, intento: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    });
  }

  it("de otra organización: 409 (la fila no es suya)", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: op.desde[0], intento: 1 });
    await expect(
      transicionar({ prisma: base.db, operacion: nombre, sesionId, organizationId: "otra-org", intento }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await filaDe(base.prisma, sesionId))?.estado).toBe(op.desde[0]);
  });
});

it("eliminar no pasa por transicionar: es un DELETE", async () => {
  await expect(
    transicionar({ prisma: base.db, operacion: "eliminar", sesionId: "x", organizationId: org.orgId }),
  ).rejects.toThrow(/borra la fila/);
});
