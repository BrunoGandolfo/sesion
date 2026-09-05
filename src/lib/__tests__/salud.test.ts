// Unitario — qué avisa el cron de salud y cuándo.
//
// Sin base: el caso de uso recibe el cliente Prisma como parámetro, así que
// acá entra un doble que contesta números fijos. Lo que se prueba es la
// DECISIÓN (qué umbral dispara qué texto), no las consultas.
//
// El caso importante es el último: `saturado` avisa aunque la cuenta sea 0.
// Ése es el agujero que reportó Codex — con más de TOPE_ATRASADAS sesiones
// aprobadas viejas, la métrica mira siempre las 200 más antiguas; si esas
// están integradas contesta 0 y una sesión más nueva trabada no se ve nunca.

import { describe, expect, it } from "vitest";

import {
  RECORDATORIO_TRABADO_MS,
  revisarSalud,
  TOPE_MINUTOS_AUDIO_MES,
  type RevisarSaludParams,
} from "@/app/api/_lib/casos-uso/salud";
import { TOPE_ATRASADAS } from "@/app/api/_lib/casos-uso/sesiones-sin-contexto";
import { RESCATE_MS } from "@/app/api/_lib/casos-uso/enviar-recordatorios";

const AHORA = new Date("2026-09-05T12:00:00.000Z");

interface Escenario {
  /** Sesiones en "procesando" hace más de 2 h. */
  sesionesTrabadas?: number;
  /** Recordatorios "fallido" en las últimas 24 h. */
  recordatoriosFallidos?: number;
  /** Recordatorios "enviando" viejos. */
  recordatoriosTrabados?: number;
  /** Cuántas aprobadas viejas devuelve la primera consulta. */
  candidatas?: number;
  /** Si true, todas las candidatas figuran ya integradas al hilo. */
  integradas?: boolean;
  /** Segundos de audio transcriptos en el mes (lo que suma el aggregate). */
  segundosAudioDelMes?: number | null;
}

/** Doble mínimo del cliente Prisma: solo lo que toca revisarSalud. */
function prismaFalso(escenario: Escenario) {
  const candidatas = Array.from({ length: escenario.candidatas ?? 0 }, (_, i) => ({
    id: `s${i}`,
    aprobadoEn: new Date("2026-09-01T00:00:00.000Z"),
    turno: { pacienteId: "p1" },
  }));

  return {
    sesionClinica: {
      count: async () => escenario.sesionesTrabadas ?? 0,
      findMany: async (args: { where: Record<string, unknown> }) => {
        // Segunda consulta: las sesiones a las que apunta ultimaSesionId.
        if ("id" in args.where) {
          return [
            { id: "u1", aprobadoEn: new Date("2026-09-02T00:00:00.000Z") },
          ];
        }
        return candidatas;
      },
      aggregate: async () => ({
        _sum: {
          duracionAudioSeg: escenario.segundosAudioDelMes ?? null,
        },
      }),
    },
    recordatorio: {
      count: async (args: { where: { estado: string } }) =>
        args.where.estado === "fallido"
          ? (escenario.recordatoriosFallidos ?? 0)
          : (escenario.recordatoriosTrabados ?? 0),
    },
    pacienteContextoClinico: {
      findMany: async () =>
        escenario.integradas
          ? [{ pacienteId: "p1", ultimaSesionId: "u1" }]
          : [],
    },
  };
}

function correr(escenario: Escenario) {
  return revisarSalud({
    // El doble implementa solo la parte del cliente que se usa.
    prisma: prismaFalso(escenario) as unknown as RevisarSaludParams["prisma"],
    ahora: AHORA,
  });
}

describe("revisarSalud", () => {
  it("con todo en orden no avisa nada", async () => {
    const salud = await correr({});

    expect(salud.alerta).toBeNull();
    expect(salud).toMatchObject({
      sesionesTrabadas: 0,
      recordatoriosFallidos: 0,
      recordatoriosTrabados: 0,
      sesionesSinContexto: 0,
      sesionesSinContextoSaturado: false,
      minutosAudioDelMes: 0,
    });
  });

  it("nombra solo la métrica que se pasó del umbral", async () => {
    const salud = await correr({ sesionesTrabadas: 3 });

    expect(salud.alerta).toBe(
      "Sesión: 3 sesiones en procesando hace más de 2 h",
    );
  });

  it("avisa los recordatorios trabados en enviando", async () => {
    const salud = await correr({ recordatoriosTrabados: 2 });

    expect(salud.recordatoriosTrabados).toBe(2);
    expect(salud.alerta).toContain(
      "2 recordatorios trabados en enviando hace más de 30 min",
    );
  });

  it("el umbral de trabados es holgadamente mayor que el lease del rescate", () => {
    // Si fueran parecidos, el cron avisaría de reservas que el despachador
    // todavía no tuvo oportunidad de retomar.
    expect(RECORDATORIO_TRABADO_MS).toBeGreaterThan(RESCATE_MS);
    expect(RECORDATORIO_TRABADO_MS).toBe(30 * 60_000);
  });

  it("junta varias métricas en un solo aviso", async () => {
    const salud = await correr({
      sesionesTrabadas: 1,
      recordatoriosFallidos: 4,
      recordatoriosTrabados: 1,
    });

    expect(salud.alerta).toBe(
      "Sesión: 1 sesiones en procesando hace más de 2 h; " +
        "4 recordatorios fallidos en 24 h; " +
        "1 recordatorios trabados en enviando hace más de 30 min",
    );
  });

  it("la métrica saturada avisa por sí sola, aunque la cuenta sea 0", async () => {
    const salud = await correr({
      candidatas: TOPE_ATRASADAS,
      integradas: true,
    });

    expect(salud.sesionesSinContexto).toBe(0);
    expect(salud.sesionesSinContextoSaturado).toBe(true);
    expect(salud.alerta).not.toBeNull();
    expect(salud.alerta).toContain(`llegó al tope de ${TOPE_ATRASADAS} filas`);
    expect(salud.alerta).toContain("mirar la base a mano");
  });

  it("sin saturación y con sesiones sin integrar avisa la cuenta, no el tope", async () => {
    const salud = await correr({ candidatas: 3, integradas: false });

    expect(salud.sesionesSinContexto).toBe(3);
    expect(salud.sesionesSinContextoSaturado).toBe(false);
    expect(salud.alerta).toBe(
      "Sesión: 3 sesiones aprobadas hace más de 24 h sin integrar al hilo",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A7 — control de gasto.
//
// El pipeline cobra por minuto de audio transcripto. Un bucle de
// reprocesamiento o un audio de tres horas subido por error gastan plata en
// silencio hasta que llega la factura. Los tokens del LLM no se pueden medir
// todavía (no hay columna ni el worker los manda): está BLOQUEADA en el
// reporte del PR con el SQL propuesto.
// ────────────────────────────────────────────────────────────────────────────

describe("minutos de audio del mes", () => {
  it("sin sesiones procesadas el aggregate devuelve null y la cuenta es 0", async () => {
    // `_sum` de una consulta sin filas es null, no 0: si no se contemplara,
    // la métrica saldría NaN y la comparación con el tope sería siempre
    // falsa — el control de gasto quedaría apagado sin que nadie lo note.
    const salud = await correr({ segundosAudioDelMes: null });

    expect(salud.minutosAudioDelMes).toBe(0);
    expect(salud.alerta).toBeNull();
  });

  it("redondea hacia arriba: medio minuto de audio se paga entero", async () => {
    const salud = await correr({ segundosAudioDelMes: 90 });

    expect(salud.minutosAudioDelMes).toBe(2);
  });

  it("por debajo del tope informa pero no avisa", async () => {
    const salud = await correr({
      segundosAudioDelMes: TOPE_MINUTOS_AUDIO_MES * 60,
    });

    expect(salud.minutosAudioDelMes).toBe(TOPE_MINUTOS_AUDIO_MES);
    expect(salud.topeMinutosAudioMes).toBe(TOPE_MINUTOS_AUDIO_MES);
    // El borde exacto NO alerta: se avisa al pasarse, no al llegar.
    expect(salud.alerta).toBeNull();
  });

  it("pasado el tope avisa y dice qué mirar", async () => {
    const salud = await correr({
      segundosAudioDelMes: (TOPE_MINUTOS_AUDIO_MES + 1) * 60,
    });

    expect(salud.minutosAudioDelMes).toBe(TOPE_MINUTOS_AUDIO_MES + 1);
    expect(salud.alerta).toContain(
      `${TOPE_MINUTOS_AUDIO_MES + 1} minutos de audio transcriptos en el mes`,
    );
    expect(salud.alerta).toContain("reprocesándose");
  });

  it("el gasto convive con las otras métricas en un solo aviso", async () => {
    const salud = await correr({
      sesionesTrabadas: 1,
      segundosAudioDelMes: (TOPE_MINUTOS_AUDIO_MES + 10) * 60,
    });

    expect(salud.alerta).toContain("1 sesiones en procesando");
    expect(salud.alerta).toContain("minutos de audio transcriptos en el mes");
  });
});
