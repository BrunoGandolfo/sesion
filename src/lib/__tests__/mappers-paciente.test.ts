// toPaciente y toPacienteConDeuda (domain.ts): la misma lista de campos, una
// sola vez, y nunca el blob cifrado de la fila.
import { describe, expect, it } from "vitest";

import { toPaciente, toPacienteConDeuda } from "@/app/api/_lib/domain";

const creado = new Date("2026-09-01T12:00:00.000Z");
const fila = {
  id: "p1",
  nombre: "Ana",
  apellido: "López",
  telefono: "+59899000000",
  tarifa: 1500,
  notas: "nota en claro",
  activo: true,
  creadoEn: creado,
  actualizadoEn: creado,
  organizationId: "org",
  // Lo que Prisma trae y no puede salir por la API.
  notasEncrypted: Buffer.from("ENC2-blob"),
};

const CAMPOS = ["activo", "actualizadoEn", "apellido", "creadoEn", "id", "nombre", "notas", "organizationId", "tarifa", "telefono"];

describe("mappers de paciente", () => {
  it("toPaciente devuelve exactamente los campos públicos", () => {
    expect(Object.keys(toPaciente(fila)).sort()).toEqual(CAMPOS);
  });

  it("toPacienteConDeuda son esos mismos campos más las estadísticas, sin el blob", () => {
    const conDeuda = toPacienteConDeuda({
      ...fila,
      turnos: [
        { fecha: creado, estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 1500 },
        { fecha: new Date("2026-09-08T12:00:00.000Z"), estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 1500 },
      ],
    });
    expect(Object.keys(conDeuda).sort()).toEqual(
      [...CAMPOS, "deudaTotal", "sesionesImpagas", "sesionesRealizadas", "totalCobrado", "ultimaSesion"].sort(),
    );
    expect(conDeuda).toMatchObject({ sesionesRealizadas: 2, totalCobrado: 1500, sesionesImpagas: 1, deudaTotal: 1500 });
    expect(JSON.stringify(conDeuda)).not.toContain("ENC2");
  });
});
