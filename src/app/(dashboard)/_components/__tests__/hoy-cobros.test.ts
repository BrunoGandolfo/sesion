// La lectura inicial y el cobro local conservan la misma cuenta y orden.

import { describe, expect, it } from "vitest";

import { deudaDeHoy } from "@/app/api/_lib/casos-uso/pendientes-terapeuta";
import type { TurnoConDeuda } from "@/app/api/_lib/domain";
import type { DashboardData } from "@/types/domain";

import { aplicarCobro } from "../datos";

const AHORA = new Date("2026-09-07T15:00:00.000Z");

function turnoImpago(
  pacienteId: string,
  nombre: string,
  apellido: string,
  tarifaCobrada: number,
  diasAtras: number,
): TurnoConDeuda {
  return {
    pacienteId,
    paciente: { nombre, apellido, telefono: "099111222" },
    estado: "realizado",
    pagoEstado: "pendiente",
    tarifaCobrada,
    duracionMin: 50,
    fecha: new Date(AHORA.getTime() - diasAtras * 24 * 60 * 60 * 1000),
  };
}

// Tres deudoras, en un orden de entrada que NO es el de salida: la que más
// debe entra última y la más antigua entra primera. Así, si algún lugar de
// la pantalla se quedara con el orden crudo de la respuesta, el test lo ve.
const TURNOS: TurnoConDeuda[] = [
  turnoImpago("p1", "Alejandro", "Sosa", 2000, 120),
  turnoImpago("p2", "Diego", "Martínez", 3000, 30),
  turnoImpago("p2", "Diego", "Martínez", 3000, 10),
  turnoImpago("p3", "Gonzalo", "Méndez", 9000, 5),
];

function datosDeHoy(): DashboardData {
  const { deudores, sinCobrar, totalSinCobrar } = deudaDeHoy(TURNOS, AHORA);
  return {
    inicio: { tarifaCargada: true, tienePacientes: true, tieneTurnos: true },
    kpis: {
      sesionesHoy: 0,
      deudaAcumulada: totalSinCobrar.monto,
      ingresosMes: 0,
    },
    sesionesHoy: [],
    deudores,
    proximaSesion: null,
    riesgoDelDia: [],
    pendientes: {
      notasParaRevisar: [],
      sinCobrar,
      totalSinCobrar,
      sinAutorizacion: [],
    },
  };
}

describe("la deuda de Hoy sale de una sola cuenta", () => {
  it("ordena los deudores por monto descendente", () => {
    const data = datosDeHoy();
    expect(data.deudores.map((d) => d.pacienteId)).toEqual(["p3", "p2", "p1"]);
  });

  it("lista los mismos deudores y en el mismo orden que el bloque de arriba", () => {
    const data = datosDeHoy();
    expect(data.pendientes.sinCobrar.map((d) => d.pacienteNombre)).toEqual(
      data.deudores.map((d) => `${d.nombre} ${d.apellido}`),
    );
  });

  it("el total es la suma de esa misma lista", () => {
    const data = datosDeHoy();
    expect(data.kpis.deudaAcumulada).toBe(
      data.deudores.reduce((total, d) => total + d.montoTotal, 0),
    );
    expect(data.pendientes.totalSinCobrar.monto).toBe(data.kpis.deudaAcumulada);
  });
});

describe("aplicarCobro — cobrar no descuadra la cuenta", () => {
  const TURNO_DE_HOY = {
    id: "t1",
    organizationId: "org",
    pacienteId: "p3",
    fecha: AHORA,
    duracion: 50 as const,
    modalidad: "presencial" as const,
    estado: "realizado" as const,
    pagoEstado: "pendiente" as const,
    pagoMetodo: null,
    pagoFecha: null,
    tarifaCobrada: 9000,
    notas: null,
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    paciente: {
      id: "p3",
      nombre: "Gonzalo",
      apellido: "Méndez",
      telefono: "099111222",
    },
  };

  function conElTurnoDeHoy(): DashboardData {
    const data = datosDeHoy();
    return { ...data, sesionesHoy: [TURNO_DE_HOY as never] };
  }

  it("baja la deuda en las listas y el total a la vez", () => {
    const despues = aplicarCobro(conElTurnoDeHoy(), "t1", "efectivo", AHORA);

    expect(despues.pendientes.totalSinCobrar.pacientes).toBe(2);
    expect(despues.deudores).toHaveLength(2);
    expect(despues.kpis.deudaAcumulada).toBe(
      despues.deudores.reduce((total, d) => total + d.montoTotal, 0),
    );
    expect(despues.pendientes.totalSinCobrar.monto).toBe(
      despues.kpis.deudaAcumulada,
    );
    expect(despues.pendientes.sinCobrar.map((d) => d.pacienteId)).toEqual(
      despues.deudores.map((d) => d.pacienteId),
    );
  });

  it("marca el turno como pagado y suma lo cobrado del mes", () => {
    const antes = conElTurnoDeHoy();
    const despues = aplicarCobro(antes, "t1", "transferencia", AHORA);

    expect(despues.sesionesHoy[0].pagoEstado).toBe("pagado");
    expect(despues.sesionesHoy[0].pagoMetodo).toBe("transferencia");
    expect(despues.kpis.ingresosMes).toBe(antes.kpis.ingresosMes + 9000);
  });

  it("no toca nada si el turno ya estaba cobrado", () => {
    const antes = conElTurnoDeHoy();
    const unaVez = aplicarCobro(antes, "t1", "efectivo", AHORA);
    expect(aplicarCobro(unaVez, "t1", "efectivo", AHORA)).toBe(unaVez);
  });

  it.each([1, 60])(
    "ordena igual que el servidor al quedar montos iguales (impago de %i días)",
    (diasAtras) => {
      // p3 debía más que p2; tras cobrar 3000 ambos deben 6000.
      // Se prueban las dos antigüedades para que no alcance un sort estable
      // que conserve por casualidad el orden previo al cobro.
      const viejo = turnoImpago("p3", "Gonzalo", "Méndez", 6000, diasAtras);
      const cobrado = turnoImpago("p3", "Gonzalo", "Méndez", 3000, 0);
      const restantes = [...TURNOS.slice(0, 3), viejo];
      const antes = deudaDeHoy([...restantes, cobrado], AHORA);
      const data = conElTurnoDeHoy();
      data.sesionesHoy = [{ ...data.sesionesHoy[0], tarifaCobrada: 3000 }];
      data.deudores = antes.deudores;
      data.kpis.deudaAcumulada = antes.totalSinCobrar.monto;
      data.pendientes = { ...data.pendientes, ...antes };

      const despues = aplicarCobro(data, "t1", "efectivo", AHORA);
      const esperado = deudaDeHoy(restantes, AHORA);
      expect(despues.deudores).toEqual(esperado.deudores);
      expect(despues.pendientes.sinCobrar).toEqual(esperado.sinCobrar);
      expect(despues.pendientes.totalSinCobrar).toEqual(esperado.totalSinCobrar);
      expect(despues.deudores.map((d) => d.pacienteId)).toEqual(
        diasAtras > 30 ? ["p3", "p2", "p1"] : ["p2", "p3", "p1"],
      );
    },
  );
});
