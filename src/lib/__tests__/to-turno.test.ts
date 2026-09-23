import { describe, it, expect } from "vitest";

import { toTurno } from "@/app/api/_lib/domain";
import { DURACIONES } from "@/lib/constantes-turno";

// `toTurno` es la frontera entre la fila de la base y el tipo del dominio.
// Con el esquema nuevo modalidad, estado, pagoEstado y pagoMetodo son enums
// de Postgres (nada que narrowear); lo que queda por fijar acá es que
// `duracion` —Int con CHECK— no se adivina, y que el blob cifrado no viaja.

type Fila = Parameters<typeof toTurno>[0];

const FILA: Fila = {
  id: "9a4b7a2e-2b1e-4c6f-9d3a-1f2e3d4c5b6a",
  fecha: new Date("2026-09-08T14:00:00.000Z"),
  duracion: 50,
  modalidad: "presencial",
  estado: "realizado",
  tarifaCobrada: 2000,
  pagoEstado: "pendiente",
  pagoFecha: null,
  pagoMetodo: null,
  notas: null,
  serieId: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"),
  actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  pacienteId: "pac_1",
  organizationId: "org_1",
};

describe("toTurno — la fila válida pasa entera", () => {
  it("copia los campos del dominio tal cual", () => {
    const turno = toTurno(FILA);
    expect(turno).toEqual(FILA);
  });

  it("acepta todas las duraciones, 120 incluida", () => {
    expect(DURACIONES).toContain(120);
    for (const duracion of DURACIONES) {
      expect(toTurno({ ...FILA, duracion }).duracion).toBe(duracion);
    }
  });

  it("conserva serieId y notas en claro", () => {
    const turno = toTurno({ ...FILA, serieId: "serie_1", notas: "trae informe" });
    expect(turno.serieId).toBe("serie_1");
    expect(turno.notas).toBe("trae informe");
  });
});

describe("toTurno — duracion se rompe, no se adivina", () => {
  // El CHECK de la migración garantiza la lista; una fila fuera de ella es
  // un invariante roto de la base, no un dato a corregir de este lado.
  it("una duración fuera de la lista lanza con el id a mano", () => {
    expect(() => toTurno({ ...FILA, duracion: 47 })).toThrow(
      `turno ${FILA.id} tiene duracion inválida: '47'`,
    );
  });
});

describe("toTurno — no filtra columnas de la base", () => {
  it("una fila con notasEncrypted no lo manda al dominio", () => {
    const conBlob = { ...FILA, notasEncrypted: Buffer.from("ENC2") } as Fila;
    const turno = toTurno(conBlob);
    expect(turno).not.toHaveProperty("notasEncrypted");
  });
});
