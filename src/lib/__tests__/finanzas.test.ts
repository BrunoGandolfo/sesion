/**
 * Integración — el resumen de Finanzas contra la base real de test.
 *
 * Lo que este archivo protege, en orden de importancia:
 *
 *   - COBRADO y TRABAJADO son dos cosas distintas y no se mezclan: una sesión
 *     dada en agosto y cobrada en septiembre suma a las dos, en meses
 *     distintos.
 *   - El mes es el de MONTEVIDEO. Una sesión del 31 a las 23:30 es de ese mes
 *     aunque en UTC ya sea el día 1 del siguiente, y lo mismo en el cambio de
 *     año.
 *   - La serie suma exactamente los totales.
 *   - La deuda por tramos cierra con /api/deudores: misma regla, misma lista.
 *   - Otra organización no ve un peso. La ruta no lleva id de recurso, así
 *     que el barrido de multi-tenant.test.ts no la cubre: se prueba acá.
 *   - Diez años de datos salen en cuatro consultas, no en una por mes.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/finanzas.test.ts
 */
import { randomUUID } from "node:crypto";

import type { MetodoPago, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_MESES_POR_MES,
  parsearMes,
  resumenFinanzas,
  type ResumenFinanzas,
} from "@/app/api/_lib/casos-uso/finanzas";
import {
  buscarTurnosConDeuda,
  calcularDeudores,
  deudaPorAntiguedad,
} from "@/app/api/_lib/domain";
import { instanteMvd } from "@/lib/fechas-montevideo";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

// La sesión que va a leer la ruta. Se cambia por test.
const sesionActual = vi.hoisted(() => ({ organizationId: "" }));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => {
    if (!sesionActual.organizationId) throw new Error("sin sesión");
    return sesionActual.organizationId;
  },
  getSessionActor: async () => ({
    organizationId: sesionActual.organizationId,
    userId: "u",
    sesionId: "s",
    rol: "titular",
    nombre: "Mariana",
    email: "mariana@test.uy",
  }),
}));

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
let rutaResumen!: (request: Request) => Promise<Response>;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;

/** El "hoy" de los tests: 15 de septiembre de 2026, mediodía de Montevideo. */
const AHORA = instanteMvd(2026, 8, 15, 12);

interface Org {
  orgId: string;
  pacientes: string[];
}

async function crearOrg(cuantasPacientes = 3): Promise<Org> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const pacientes: string[] = [];
  for (let i = 0; i < cuantasPacientes; i += 1) {
    const p = await prismaRaw.paciente.create({
      data: {
        nombre: `Paciente${i}`,
        apellido: "Ficticia",
        telefono: `+5989900${String(i).padStart(4, "0")}`,
        tarifa: 1000,
        organizationId: org.id,
      },
    });
    pacientes.push(p.id);
  }
  return { orgId: org.id, pacientes };
}

interface TurnoFixture {
  fecha: Date;
  estado?: "programado" | "realizado" | "cancelado" | "ausente";
  tarifa?: number;
  pagoFecha?: Date | null;
  pagoMetodo?: MetodoPago | null;
  paciente?: number;
  duracion?: number;
}

function filaTurno(org: Org, t: TurnoFixture) {
  const pagado = t.pagoFecha != null;
  return {
    fecha: t.fecha,
    duracion: t.duracion ?? 50,
    estado: t.estado ?? "realizado",
    tarifaCobrada: t.tarifa ?? 1000,
    pagoEstado: (pagado ? "pagado" : "pendiente") as "pagado" | "pendiente",
    pagoFecha: t.pagoFecha ?? null,
    pagoMetodo: pagado ? (t.pagoMetodo ?? "efectivo") : null,
    pacienteId: org.pacientes[t.paciente ?? 0],
    organizationId: org.orgId,
  };
}

const sembrar = (org: Org, turnos: TurnoFixture[]) =>
  prismaRaw.turno.createMany({ data: turnos.map((t) => filaTurno(org, t)) });

/** El resumen, como lo pide la pantalla. */
function resumen(org: Org, opciones: Partial<Parameters<typeof resumenFinanzas>[0]> = {}) {
  return resumenFinanzas({
    prisma: db,
    organizationId: org.orgId,
    ahora: AHORA,
    ...opciones,
  });
}

const periodo = (r: ResumenFinanzas, clave: string) =>
  r.serie.find((p) => p.clave === clave);

/**
 * Un cliente que delega en el real y cuenta cada viaje a la base: los
 * `$queryRaw` de los agregados y los `findMany` de la lista de deuda.
 */
function contarViajes(real: ClienteCifrado) {
  let queryRaw = 0;
  let findMany = 0;
  const cliente = new Proxy(real, {
    get(destino, prop, receptor) {
      if (prop === "$queryRaw") {
        return (...args: unknown[]) => {
          queryRaw += 1;
          return (destino as unknown as Record<string, (...a: unknown[]) => unknown>).$queryRaw(...args);
        };
      }
      if (prop === "turno") {
        const turno = Reflect.get(destino, prop, receptor) as unknown as Record<string, (...a: unknown[]) => unknown>;
        return new Proxy(turno, {
          get(t, p) {
            if (p === "findMany") {
              return (...args: unknown[]) => {
                findMany += 1;
                return t.findMany(...args);
              };
            }
            return Reflect.get(t, p);
          },
        });
      }
      return Reflect.get(destino, prop, receptor);
    },
  }) as ClienteCifrado;
  return { cliente, total: () => queryRaw + findMany };
}

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());

  // El cliente de test entra por el cache global que lee src/lib/db.ts, antes
  // de importar la ruta (mismo patrón que multi-tenant.test.ts).
  (globalThis as unknown as { prisma: unknown }).prisma = db;
  const modulo = await import("@/app/api/finanzas/resumen/route");
  rutaResumen = modulo.GET as typeof rutaResumen;
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
  sesionActual.organizationId = "";
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

// ────────────────────────────────────────────────────────────────────────────

describe("COBRADO y TRABAJADO son dos cosas distintas", () => {
  it("una sesión de agosto cobrada en septiembre suma a agosto y a septiembre, en columnas distintas", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      {
        fecha: instanteMvd(2026, 7, 20, 15),
        tarifa: 1500,
        pagoFecha: instanteMvd(2026, 8, 3, 10),
      },
    ]);

    const r = await resumen(org, {
      desde: parsearMes("2026-08"),
      hasta: parsearMes("2026-09"),
    });

    const agosto = periodo(r, "2026-08")!;
    const septiembre = periodo(r, "2026-09")!;

    expect(agosto.trabajado).toBe(1500);
    expect(agosto.sesionesRealizadas).toBe(1);
    expect(agosto.cobrado).toBe(0);
    expect(agosto.sesionesCobradas).toBe(0);

    expect(septiembre.cobrado).toBe(1500);
    expect(septiembre.sesionesCobradas).toBe(1);
    expect(septiembre.trabajado).toBe(0);
    expect(septiembre.sesionesRealizadas).toBe(0);

    // Y la sesión de agosto figura como ya cobrada EN AGOSTO: lo cobrado de
    // lo trabajado no mira cuándo entró la plata.
    expect(agosto.trabajadoCobrado).toBe(1500);
    expect(agosto.trabajadoSinCobrar).toBe(0);
  });

  it("lo trabajado y no cobrado sale por separado, con su cantidad", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      { fecha: instanteMvd(2026, 8, 2, 15), tarifa: 1000, pagoFecha: instanteMvd(2026, 8, 2, 16) },
      { fecha: instanteMvd(2026, 8, 3, 15), tarifa: 1200 },
      { fecha: instanteMvd(2026, 8, 4, 15), tarifa: 800 },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    const mes = periodo(r, "2026-09")!;

    expect(mes.trabajado).toBe(3000);
    expect(mes.trabajadoCobrado).toBe(1000);
    expect(mes.trabajadoSinCobrar).toBe(2000);
    expect(mes.sesionesRealizadasSinCobrar).toBe(2);
    expect(mes.tarifaPromedio).toBe(1000);
  });
});

describe("la duración no pesa en la plata", () => {
  it("una sesión de 120 minutos suma su tarifa, igual que una de 50: ni el doble ni por minuto", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      { fecha: instanteMvd(2026, 8, 2, 10), duracion: 120, tarifa: 1000, pagoFecha: instanteMvd(2026, 8, 2, 12) },
      { fecha: instanteMvd(2026, 8, 3, 10), duracion: 50, tarifa: 1000, pagoFecha: instanteMvd(2026, 8, 3, 11) },
      { fecha: instanteMvd(2026, 8, 4, 10), duracion: 120, tarifa: 1000 },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    const mes = periodo(r, "2026-09")!;

    expect(mes.trabajado).toBe(3000);
    expect(mes.sesionesRealizadas).toBe(3);
    expect(mes.cobrado).toBe(2000);
    expect(mes.sesionesCobradas).toBe(2);
    expect(mes.trabajadoSinCobrar).toBe(1000);
    expect(mes.tarifaPromedio).toBe(1000);
  });
});

describe("el índice de lo cobrado", () => {
  it("turnos (organization_id, pago_fecha) existe tras migrate deploy", async () => {
    // Lo cobrado de un mes filtra por organization_id y un rango de
    // pago_fecha (resumenFinanzas, /api/turnos/cobros, el tablero).
    const filas = await prismaRaw.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'turnos'
        AND indexname = 'turnos_organization_id_pago_fecha_idx'`;
    expect(filas).toHaveLength(1);
    expect(filas[0].indexdef).toMatch(/\(organization_id, pago_fecha\)/);
  });
});

describe("el mes es el de Montevideo", () => {
  it("una sesión del 31 a las 23:30 cae en ese mes y no en el siguiente", async () => {
    const org = await crearOrg();
    // 23:30 de Montevideo del 31/8 es 02:30 UTC del 1/9: sin corregir, caería
    // en septiembre.
    const borde = instanteMvd(2026, 7, 31, 23, 30);
    expect(borde.toISOString()).toBe("2026-09-01T02:30:00.000Z");
    await sembrar(org, [{ fecha: borde, tarifa: 900 }]);

    const r = await resumen(org, {
      desde: parsearMes("2026-08"),
      hasta: parsearMes("2026-09"),
    });

    expect(periodo(r, "2026-08")!.trabajado).toBe(900);
    expect(periodo(r, "2026-09")!.trabajado).toBe(0);
  });

  it("lo mismo en el cambio de año: el 31/12 a las 23:30 es de diciembre", async () => {
    const org = await crearOrg();
    const borde = instanteMvd(2025, 11, 31, 23, 30);
    expect(borde.toISOString()).toBe("2026-01-01T02:30:00.000Z");
    await sembrar(org, [
      { fecha: borde, tarifa: 700, pagoFecha: borde, pagoMetodo: "transferencia" },
    ]);

    const r = await resumen(org, {
      desde: parsearMes("2025-12"),
      hasta: parsearMes("2026-01"),
    });

    expect(periodo(r, "2025-12")!.trabajado).toBe(700);
    expect(periodo(r, "2025-12")!.cobrado).toBe(700);
    expect(periodo(r, "2026-01")!.trabajado).toBe(0);
    expect(periodo(r, "2026-01")!.cobrado).toBe(0);
  });

  it("y agrupando por año, el 31/12 tardío es del año que termina", async () => {
    const org = await crearOrg();
    await sembrar(org, [{ fecha: instanteMvd(2025, 11, 31, 23, 30), tarifa: 700 }]);

    const r = await resumen(org, {
      desde: parsearMes("2025-01"),
      hasta: parsearMes("2026-12"),
      granularidad: "anio",
    });

    expect(periodo(r, "2025")!.trabajado).toBe(700);
    expect(periodo(r, "2026")!.trabajado).toBe(0);
  });
});

describe("la serie cierra con los totales", () => {
  it("sumar la serie da exactamente los totales, por mes y por año", async () => {
    const org = await crearOrg(3);
    const turnos: TurnoFixture[] = [];
    for (let mes = 0; mes < 18; mes += 1) {
      for (let i = 0; i < 4; i += 1) {
        const fecha = instanteMvd(2025, 3 + mes, 5 + i, 15);
        turnos.push({
          fecha,
          tarifa: 900 + i * 100,
          estado: i === 3 ? "ausente" : "realizado",
          pagoFecha: i < 2 ? instanteMvd(2025, 3 + mes, 6 + i, 10) : null,
          paciente: i % 3,
        });
      }
      turnos.push({ fecha: instanteMvd(2025, 3 + mes, 20, 15), estado: "cancelado" });
    }
    await sembrar(org, turnos);

    for (const granularidad of ["mes", "anio"] as const) {
      const r = await resumen(org, {
        desde: parsearMes("2025-04"),
        hasta: parsearMes("2026-09"),
        granularidad,
      });
      const suma = (campo: "cobrado" | "trabajado" | "sesionesRealizadas" | "ausencias" | "ausenciasMonto" | "canceladas" | "trabajadoSinCobrar") =>
        r.serie.reduce((t, p) => t + p[campo], 0);

      expect(suma("cobrado"), granularidad).toBe(r.totales.cobrado);
      expect(suma("trabajado"), granularidad).toBe(r.totales.trabajado);
      expect(suma("sesionesRealizadas"), granularidad).toBe(r.totales.sesionesRealizadas);
      expect(suma("ausencias"), granularidad).toBe(r.totales.ausencias);
      expect(suma("ausenciasMonto"), granularidad).toBe(r.totales.ausenciasMonto);
      expect(suma("canceladas"), granularidad).toBe(r.totales.canceladas);
      expect(suma("trabajadoSinCobrar"), granularidad).toBe(r.totales.trabajadoSinCobrar);
      // El cobrado por método también cierra con el cobrado total.
      expect(
        r.totales.cobradoPorMetodo.reduce((t, m) => t + m.monto, 0),
        granularidad,
      ).toBe(r.totales.cobrado);
    }
  });

  it("las pacientes distintas NO se suman entre meses: quien vino en dos meses es una sola en el año", async () => {
    const org = await crearOrg(2);
    await sembrar(org, [
      { fecha: instanteMvd(2026, 0, 10, 15), paciente: 0 },
      { fecha: instanteMvd(2026, 1, 10, 15), paciente: 0 },
      { fecha: instanteMvd(2026, 1, 11, 15), paciente: 1 },
    ]);

    const porMes = await resumen(org, {
      desde: parsearMes("2026-01"), hasta: parsearMes("2026-02"), granularidad: "mes",
    });
    expect(periodo(porMes, "2026-01")!.pacientesDistintas).toBe(1);
    expect(periodo(porMes, "2026-02")!.pacientesDistintas).toBe(2);
    expect(porMes.totales.pacientesDistintas).toBe(2);

    const porAnio = await resumen(org, {
      desde: parsearMes("2026-01"), hasta: parsearMes("2026-02"), granularidad: "anio",
    });
    expect(periodo(porAnio, "2026")!.pacientesDistintas).toBe(2);
  });
});

describe("montos enteros y promedios con regla escrita", () => {
  it("ninguna división deja decimales en un monto, y el promedio redondea al peso", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      { fecha: instanteMvd(2026, 8, 1, 15), tarifa: 1000 },
      { fecha: instanteMvd(2026, 8, 2, 15), tarifa: 1000 },
      { fecha: instanteMvd(2026, 8, 3, 15), tarifa: 1001 },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    const mes = periodo(r, "2026-09")!;

    // 3001 / 3 = 1000,333… → 1000.
    expect(mes.tarifaPromedio).toBe(1000);
    for (const valor of [mes.cobrado, mes.trabajado, mes.trabajadoSinCobrar, mes.ausenciasMonto, mes.tarifaPromedio!]) {
      expect(Number.isInteger(valor)).toBe(true);
    }
  });

  it("sin sesiones realizadas no hay promedio inventado", async () => {
    const org = await crearOrg();
    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    expect(periodo(r, "2026-09")!.tarifaPromedio).toBeNull();
    expect(r.proporcionCobrada.deCadaDiez).toBeNull();
  });
});

describe("de cada diez sesiones que diste, cobraste N", () => {
  it("mira las sesiones realizadas del período, no las que se cobraron en él", async () => {
    const org = await crearOrg();
    const turnos: TurnoFixture[] = [];
    for (let i = 0; i < 10; i += 1) {
      turnos.push({
        fecha: instanteMvd(2026, 8, i + 1, 15),
        pagoFecha: i < 9 ? instanteMvd(2026, 8, i + 2, 10) : null,
      });
    }
    // Un cobro de una sesión vieja: entra en COBRADO de septiembre y no puede
    // ensuciar la proporción.
    turnos.push({ fecha: instanteMvd(2026, 5, 1, 15), pagoFecha: instanteMvd(2026, 8, 20, 10) });
    await sembrar(org, turnos);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });

    expect(r.proporcionCobrada).toEqual({
      deCadaDiez: 9,
      porcentaje: 90,
      sesionesRealizadas: 10,
      sesionesRealizadasCobradas: 9,
    });
    // El cobro de la sesión de junio sí suma a lo cobrado del mes.
    expect(r.totales.sesionesCobradas).toBe(10);
  });
});

describe("comparaciones", () => {
  it("compara contra el período anterior de igual largo y contra el año anterior", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      // Mismo mes del año anterior.
      { fecha: instanteMvd(2025, 8, 5, 15), tarifa: 1000, pagoFecha: instanteMvd(2025, 8, 5, 16) },
      // Mes anterior.
      { fecha: instanteMvd(2026, 7, 5, 15), tarifa: 2000, pagoFecha: instanteMvd(2026, 7, 5, 16) },
      // El mes pedido.
      { fecha: instanteMvd(2026, 8, 5, 15), tarifa: 3000, pagoFecha: instanteMvd(2026, 8, 5, 16) },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });

    expect(r.comparaciones.periodoAnterior).toMatchObject({
      desde: "2026-08", hasta: "2026-08",
      cobrado: 2000, variacionCobrado: 1000, porcentajeCobrado: 50,
    });
    expect(r.comparaciones.mismoPeriodoAnioAnterior).toMatchObject({
      desde: "2025-09", hasta: "2025-09",
      cobrado: 1000, variacionCobrado: 2000, porcentajeCobrado: 200,
    });
  });

  it("sin datos en la ventana, la comparación es null y no un cero inventado", async () => {
    const org = await crearOrg();
    await sembrar(org, [{ fecha: instanteMvd(2026, 8, 5, 15), pagoFecha: instanteMvd(2026, 8, 5, 16) }]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });

    expect(r.comparaciones.periodoAnterior).toBeNull();
    expect(r.comparaciones.mismoPeriodoAnioAnterior).toBeNull();
  });

  it("con datos que dan cero cobrado, el cero es real y el porcentaje es null", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      { fecha: instanteMvd(2026, 7, 5, 15), tarifa: 1000 }, // trabajada, sin cobrar
      { fecha: instanteMvd(2026, 8, 5, 15), tarifa: 1000, pagoFecha: instanteMvd(2026, 8, 5, 16) },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });

    expect(r.comparaciones.periodoAnterior).toMatchObject({
      cobrado: 0,
      trabajado: 1000,
      porcentajeCobrado: null,
      porcentajeTrabajado: 0,
    });
  });
});

describe("la deuda de hoy cierra con /api/deudores", () => {
  it("los tramos suman lo mismo que la lista de deudores, con la misma regla", async () => {
    const org = await crearOrg(3);
    await sembrar(org, [
      { fecha: instanteMvd(2026, 8, 10, 15), tarifa: 1000, paciente: 0 },   // 5 días
      { fecha: instanteMvd(2026, 8, 1, 15), tarifa: 1100, paciente: 1 },    // 14 días
      { fecha: instanteMvd(2026, 7, 1, 15), tarifa: 1200, paciente: 0 },    // 45 días
      { fecha: instanteMvd(2026, 4, 1, 15), tarifa: 1300, paciente: 2 },    // 137 días
      // No es deuda: cancelada, ausente, y una realizada ya cobrada.
      { fecha: instanteMvd(2026, 8, 2, 15), estado: "cancelado", paciente: 0 },
      { fecha: instanteMvd(2026, 8, 3, 15), estado: "ausente", paciente: 0 },
      { fecha: instanteMvd(2026, 8, 4, 15), pagoFecha: instanteMvd(2026, 8, 4, 16), paciente: 0 },
    ]);

    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });

    // Lo que ve /api/deudores con los mismos datos.
    const turnos = await buscarTurnosConDeuda(db, org.orgId);
    const deudores = calcularDeudores(turnos, AHORA);
    const totalDeudores = deudores.reduce((t, d) => t + d.montoTotal, 0);
    const sesionesDeudores = deudores.reduce((t, d) => t + d.sesionesImpagas, 0);

    expect(r.deudaHoy.monto).toBe(totalDeudores);
    expect(r.deudaHoy.sesiones).toBe(sesionesDeudores);
    expect(r.deudaHoy.monto).toBe(1000 + 1100 + 1200 + 1300);

    expect(r.deudaHoy.tramos).toEqual([
      { tramo: "hasta30", sesiones: 2, monto: 2100, pacientes: 2 },
      { tramo: "de31a90", sesiones: 1, monto: 1200, pacientes: 1 },
      { tramo: "mas90", sesiones: 1, monto: 1300, pacientes: 1 },
    ]);
    // Y la misma función pura, llamada aparte, da lo mismo.
    expect(deudaPorAntiguedad(turnos, AHORA)).toEqual(r.deudaHoy.tramos);
  });

  it("los tres tramos salen siempre, en cero cuando no hay nada", async () => {
    const org = await crearOrg();
    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    expect(r.deudaHoy.tramos.map((t) => t.tramo)).toEqual(["hasta30", "de31a90", "mas90"]);
    expect(r.deudaHoy.monto).toBe(0);
  });
});

describe("granularidad", () => {
  it("hasta 24 meses agrupa por mes; pasando eso, por año", async () => {
    const org = await crearOrg();
    const veinticuatro = await resumen(org, {
      desde: parsearMes("2024-10"), hasta: parsearMes("2026-09"),
    });
    expect(veinticuatro.granularidad).toBe("mes");
    expect(veinticuatro.granularidadAutomatica).toBe(true);
    expect(veinticuatro.serie).toHaveLength(MAX_MESES_POR_MES);

    const veinticinco = await resumen(org, {
      desde: parsearMes("2024-09"), hasta: parsearMes("2026-09"),
    });
    expect(veinticinco.granularidad).toBe("anio");
    expect(veinticinco.serie.map((p) => p.clave)).toEqual(["2024", "2025", "2026"]);
  });

  it("pedida a mano gana, y queda dicho que no la eligió el servidor", async () => {
    const org = await crearOrg();
    const r = await resumen(org, {
      desde: parsearMes("2020-01"), hasta: parsearMes("2026-09"), granularidad: "mes",
    });
    expect(r.granularidad).toBe("mes");
    expect(r.granularidadAutomatica).toBe(false);
    expect(r.serie).toHaveLength(81);
  });

  it("sin período, son los últimos doce meses hasta hoy", async () => {
    const org = await crearOrg();
    const r = await resumen(org);
    expect(r.desde).toBe("2025-10");
    expect(r.hasta).toBe("2026-09");
    expect(r.serie).toHaveLength(12);
  });
});

describe("primer mes con datos", () => {
  it("es el del turno o el del pago más viejo, lo que venga antes", async () => {
    const org = await crearOrg();
    await sembrar(org, [
      { fecha: instanteMvd(2021, 2, 4, 15), tarifa: 800, pagoFecha: instanteMvd(2026, 8, 1, 10) },
      { fecha: instanteMvd(2023, 5, 4, 15), tarifa: 800 },
    ]);
    const r = await resumen(org, { desde: parsearMes("2026-09"), hasta: parsearMes("2026-09") });
    expect(r.primerMesConDatos).toBe("2021-03");
  });

  it("sin un solo turno, es null", async () => {
    const org = await crearOrg();
    const r = await resumen(org);
    expect(r.primerMesConDatos).toBeNull();
  });
});

describe("aislamiento entre organizaciones", () => {
  it("la ruta no deja ver un peso de otra organización", async () => {
    const a = await crearOrg();
    const b = await crearOrg();
    await sembrar(a, [
      { fecha: instanteMvd(2026, 8, 5, 15), tarifa: 5000, pagoFecha: instanteMvd(2026, 8, 5, 16) },
      { fecha: instanteMvd(2026, 8, 6, 15), tarifa: 7000 },
    ]);

    sesionActual.organizationId = b.orgId;
    const res = await rutaResumen(
      new Request("http://localhost/api/finanzas/resumen?desde=2026-09&hasta=2026-09"),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ResumenFinanzas };

    expect(data.totales.cobrado).toBe(0);
    expect(data.totales.trabajado).toBe(0);
    expect(data.totales.sesionesRealizadas).toBe(0);
    expect(data.deudaHoy.monto).toBe(0);
    expect(data.primerMesConDatos).toBeNull();
    // Y por las dudas: ningún número de A aparece en el cuerpo.
    const cuerpo = JSON.stringify(data);
    expect(cuerpo).not.toContain("5000");
    expect(cuerpo).not.toContain("7000");

    // La dueña sí los ve.
    sesionActual.organizationId = a.orgId;
    const propia = await rutaResumen(
      new Request("http://localhost/api/finanzas/resumen?desde=2026-09&hasta=2026-09"),
    );
    const suyo = (await propia.json()).data as ResumenFinanzas;
    expect(suyo.totales.cobrado).toBe(5000);
    expect(suyo.totales.trabajado).toBe(12000);
  });

  it("la ruta envuelve en {data} y rechaza parámetros inválidos", async () => {
    const org = await crearOrg();
    sesionActual.organizationId = org.orgId;

    const ok = await rutaResumen(new Request("http://localhost/api/finanzas/resumen"));
    expect(Object.keys(await ok.json())).toEqual(["data"]);

    for (const query of ["?desde=2026-13", "?desde=septiembre", "?granularidad=semana"]) {
      const res = await rutaResumen(new Request(`http://localhost/api/finanzas/resumen${query}`));
      expect(res.status, query).toBe(400);
    }
  });
});

describe("diez años de datos", () => {
  it("responden en pocas consultas agregadas, no una por mes", async () => {
    const org = await crearOrg(40);
    const turnos: TurnoFixture[] = [];
    // 120 meses × 108 turnos ≈ 13.000.
    for (let mes = 0; mes < 120; mes += 1) {
      for (let i = 0; i < 108; i += 1) {
        const dia = 1 + (i % 28);
        const estado = i % 20 === 0 ? "ausente" : i % 25 === 0 ? "cancelado" : "realizado";
        turnos.push({
          fecha: instanteMvd(2016, 9 + mes, dia, 8 + (i % 12)),
          estado,
          tarifa: 800 + (i % 7) * 100,
          pagoFecha: i % 3 === 0 ? null : instanteMvd(2016, 9 + mes, dia, 20),
          pagoMetodo: (["efectivo", "transferencia", "mercadopago"] as const)[i % 3],
          paciente: i % 40,
        });
      }
    }
    // createMany por tandas: 13.000 filas en una sola sentencia es innecesario.
    for (let i = 0; i < turnos.length; i += 2000) {
      await sembrar(org, turnos.slice(i, i + 2000));
    }
    expect(await prismaRaw.turno.count({ where: { organizationId: org.orgId } })).toBe(12_960);

    // El caso de uso recibe el cliente, así que se le puede dar uno que
    // cuenta viajes a la base. Es la única forma honesta de probar que el
    // número de consultas NO crece con los meses.
    const contador = contarViajes(db);

    const arranque = Date.now();
    const r = await resumenFinanzas({
      prisma: contador.cliente,
      organizationId: org.orgId,
      ahora: AHORA,
      desde: parsearMes("2016-10"),
      hasta: parsearMes("2026-09"),
    });
    const tardo = Date.now() - arranque;
    const viajesDeDiezAnios = contador.total();

    expect(r.granularidad).toBe("anio");
    expect(r.serie).toHaveLength(11);
    expect(r.totales.sesionesRealizadas).toBeGreaterThan(11_000);
    expect(r.serie.reduce((t, p) => t + p.trabajado, 0)).toBe(r.totales.trabajado);

    // Cuatro agregadas + la lista de deuda que comparte con /api/deudores.
    expect(viajesDeDiezAnios).toBe(5);

    // Y el mismo pedido por UN mes cuesta exactamente lo mismo: si hubiera
    // una consulta por mes, esto daría 5 contra 125.
    const unMes = contarViajes(db);
    await resumenFinanzas({
      prisma: unMes.cliente,
      organizationId: org.orgId,
      ahora: AHORA,
      desde: parsearMes("2026-09"),
      hasta: parsearMes("2026-09"),
    });
    expect(unMes.total()).toBe(viajesDeDiezAnios);

    console.log(`[finanzas] 12.960 turnos, 10 años: ${tardo} ms, ${viajesDeDiezAnios} consultas`);
    expect(tardo).toBeLessThan(10_000);
  }, 180_000);
});
