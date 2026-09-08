import { describe, it, expect } from "vitest";
import type { Turno as PrismaTurno } from "@prisma/client";

import { toTurno } from "@/app/api/_lib/domain";

// `toTurno` es la frontera entre lo que la base guarda como String y lo que
// el dominio promete como unión. Estos tests fijan dónde perdona y dónde no.

const FILA: PrismaTurno = {
  id: "turno_abc123",
  fecha: new Date("2026-09-08T14:00:00.000Z"),
  duracion: 50,
  modalidad: "presencial",
  estado: "realizado",
  tarifaCobrada: 2000,
  pagoEstado: "pendiente",
  pagoFecha: null,
  pagoMetodo: null,
  notas: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"),
  actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  pacienteId: "pac_1",
  organizationId: "org_1",
};

/** Una fila con una columna pisada por un valor que el dominio no conoce. */
function filaCon(campo: keyof PrismaTurno, valor: unknown): PrismaTurno {
  return { ...FILA, [campo]: valor } as PrismaTurno;
}

describe("toTurno — la fila válida pasa entera", () => {
  it("deja los cinco campos como están", () => {
    const turno = toTurno(FILA);
    expect(turno.duracion).toBe(50);
    expect(turno.modalidad).toBe("presencial");
    expect(turno.estado).toBe("realizado");
    expect(turno.pagoEstado).toBe("pendiente");
    expect(turno.pagoMetodo).toBeNull();
  });

  it("acepta los cuatro estados y los dos estados de pago del dominio", () => {
    for (const estado of ["programado", "realizado", "cancelado", "ausente"]) {
      expect(toTurno(filaCon("estado", estado)).estado).toBe(estado);
    }
    for (const pago of ["pendiente", "pagado"]) {
      expect(toTurno(filaCon("pagoEstado", pago)).pagoEstado).toBe(pago);
    }
  });
});

describe("toTurno — estado y pagoEstado se rompen, no se adivinan", () => {
  // El P2 de Codex: caer a "pendiente" ante un pagoEstado desconocido le
  // muestra a la profesional un botón Cobrar que después choca contra
  // cobrar-turno —que actualiza sólo las filas cuyo valor guardado es
  // exactamente "pendiente"— y termina siempre en 409; y los agregados de
  // deuda, que filtran el valor crudo antes de pasar por acá, dan un total
  // distinto. Es un invariante de la base: el turno no sale.

  it("un pagoEstado desconocido lanza en vez de mapear a 'pendiente'", () => {
    expect(() => toTurno(filaCon("pagoEstado", "reembolsado"))).toThrow(
      "turno turno_abc123 tiene pagoEstado inválido: 'reembolsado'",
    );
  });

  it("el error nombra el turno y el valor que vino, para poder ir a buscarlo", () => {
    let mensaje = "";
    try {
      toTurno({ ...filaCon("pagoEstado", "parcial"), id: "turno_xyz" });
    } catch (error) {
      mensaje = error instanceof Error ? error.message : String(error);
    }
    expect(mensaje).toContain("turno_xyz");
    expect(mensaje).toContain("parcial");
  });

  it("un estado desconocido lanza en vez de mapear a 'programado'", () => {
    expect(() => toTurno(filaCon("estado", "borrador"))).toThrow(
      "turno turno_abc123 tiene estado inválido: 'borrador'",
    );
  });

  it("null y string vacío tampoco pasan por default", () => {
    expect(() => toTurno(filaCon("pagoEstado", null))).toThrow(/pagoEstado/);
    expect(() => toTurno(filaCon("pagoEstado", ""))).toThrow(/pagoEstado/);
    expect(() => toTurno(filaCon("estado", null))).toThrow(/estado/);
  });

  it("no devuelve un turno a medias: lanza, no mapea y sigue", () => {
    expect(() => toTurno(filaCon("pagoEstado", "reembolsado"))).toThrow(Error);
  });
});

describe("toTurno — duracion y modalidad sí caen al default", () => {
  // Son preferencias de cómo se dio la sesión. Mostrar 50 minutos donde la
  // base dice 47 no afirma ningún hecho sobre el que la app después actúe.
  it("una duración fuera de la lista cae a 50", () => {
    expect(toTurno(filaCon("duracion", 47)).duracion).toBe(50);
  });

  it("una modalidad desconocida cae a presencial", () => {
    expect(toTurno(filaCon("modalidad", "telepatía")).modalidad).toBe(
      "presencial",
    );
  });
});

describe("toTurno — pagoMetodo", () => {
  it("null se conserva: es un turno sin cobrar, no un valor desconocido", () => {
    expect(toTurno(filaCon("pagoMetodo", null)).pagoMetodo).toBeNull();
  });

  it("un método que no existe cae a 'otro', que sí es del dominio", () => {
    expect(toTurno(filaCon("pagoMetodo", "cripto")).pagoMetodo).toBe("otro");
  });

  it("los métodos reales pasan tal cual", () => {
    expect(toTurno(filaCon("pagoMetodo", "mercadopago")).pagoMetodo).toBe(
      "mercadopago",
    );
  });
});
