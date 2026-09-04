/**
 * armarProgresoClinico — el recorrido de una paciente.
 *
 * Test puro: el caso de uso recibe las filas ya leídas, así que no hace
 * falta base de datos. Lo que se verifica es lo que el gráfico promete:
 * el rango recorta las sesiones pero no la numeración, los temas se cuentan
 * sobre toda la historia y las señales de riesgo salen completas.
 */
import { describe, expect, it } from "vitest";

import {
  armarProgresoClinico,
  parseRangoProgreso,
  type SesionCruda,
} from "@/app/api/_lib/casos-uso/progreso-clinico";
import type { DatosEstructurados } from "@/lib/sesion-clinica/schema";

const AHORA = new Date("2026-09-03T15:00:00.000Z");

function diasAntes(dias: number): Date {
  return new Date(AHORA.getTime() - dias * 86_400_000);
}

function sinFlags(): NonNullable<DatosEstructurados["flagsRiesgo"]> {
  return {
    ideacionSuicida: false,
    autolesion: false,
    violenciaTerceros: false,
    sintomasPsicoticos: false,
    crisisPanico: false,
    detalle: "",
  };
}

function sesion(
  id: string,
  fecha: Date,
  datos: DatosEstructurados | null = {},
): SesionCruda {
  return { sesionId: id, fecha, datos };
}

/** N sesiones, la más vieja primero, una por semana hacia atrás. */
function semanales(cantidad: number, temaPorSesion?: (i: number) => string[]) {
  return Array.from({ length: cantidad }, (_, i) =>
    sesion(`s${i + 1}`, diasAntes((cantidad - i) * 7), {
      temas: temaPorSesion?.(i) ?? [],
    }),
  );
}

function progreso(sesiones: SesionCruda[], rango = "todo" as const) {
  return armarProgresoClinico({
    pacienteId: "pac1",
    sesiones,
    rango,
    ahora: AHORA,
  });
}

describe("armarProgresoClinico — sin sesiones", () => {
  it("devuelve las tres listas vacías", () => {
    const resultado = progreso([]);

    expect(resultado).toEqual({
      pacienteId: "pac1",
      totalSesiones: 0,
      rango: "todo",
      sesiones: [],
      temas: [],
      riesgos: [],
    });
  });
});

describe("armarProgresoClinico — rango", () => {
  it("10s trae las últimas 10 y conserva la numeración global", () => {
    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones: semanales(14),
      rango: "10s",
      ahora: AHORA,
    });

    expect(resultado.totalSesiones).toBe(14);
    expect(resultado.sesiones).toHaveLength(10);
    // La primera del rango es la quinta de la historia, y se llama así.
    expect(resultado.sesiones[0].numero).toBe(5);
    expect(resultado.sesiones[0].sesionId).toBe("s5");
    expect(resultado.sesiones.at(-1)?.numero).toBe(14);
  });

  it("10s con menos de 10 sesiones las trae todas", () => {
    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones: semanales(3),
      rango: "10s",
      ahora: AHORA,
    });

    expect(resultado.sesiones.map((s) => s.numero)).toEqual([1, 2, 3]);
  });

  it("3m corta por fecha, no por cantidad", () => {
    const sesiones = [
      sesion("vieja", diasAntes(200)),
      sesion("limite", diasAntes(80)),
      sesion("reciente", diasAntes(10)),
    ];

    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones,
      rango: "3m",
      ahora: AHORA,
    });

    expect(resultado.sesiones.map((s) => s.sesionId)).toEqual([
      "limite",
      "reciente",
    ]);
    // El total y los temas siguen mirando toda la historia.
    expect(resultado.totalSesiones).toBe(3);
  });

  it("6m alcanza lo que 3m dejó afuera", () => {
    const sesiones = [
      sesion("vieja", diasAntes(200)),
      sesion("media", diasAntes(120)),
      sesion("reciente", diasAntes(10)),
    ];

    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones,
      rango: "6m",
      ahora: AHORA,
    });

    expect(resultado.sesiones.map((s) => s.sesionId)).toEqual([
      "media",
      "reciente",
    ]);
  });

  it("el query param inválido cae en el default 10s", () => {
    expect(parseRangoProgreso(null)).toBe("10s");
    expect(parseRangoProgreso("1a")).toBe("10s");
    expect(parseRangoProgreso("todo")).toBe("todo");
  });
});

describe("armarProgresoClinico — la serie de sesiones", () => {
  it("copia lo que el análisis dejó y pone null donde no hay dato", () => {
    const fecha = diasAntes(7);
    const resultado = progreso([
      sesion("s1", fecha, {
        intensidadEmocional: 7,
        alianzaTerapeutica: "estable",
        temas: ["duelo", "trabajo"],
        progresoPercibido: "Sostiene el encuadre.",
        riesgoDetectado: {
          nivel: "bajo",
          indicadores: ["desesperanza"],
          evidencia: [{ timestamp: "12:30", quote: "no sé para qué sigo" }],
          notaParaTerapeuta: null,
        },
        intervenciones: [
          { tipo: "reformulacion", descripcion: "…" },
          { tipo: "reformulacion", descripcion: "…" },
          { tipo: "senalamiento", descripcion: "…" },
        ],
      }),
      sesion("s2", diasAntes(1), {}),
    ]);

    expect(resultado.sesiones[0]).toEqual({
      sesionId: "s1",
      fecha: fecha.toISOString(),
      numero: 1,
      intensidadEmocional: 7,
      alianzaTerapeutica: "estable",
      temas: ["duelo", "trabajo"],
      nivelRiesgo: "bajo",
      flagsRiesgo: null,
      intervenciones: { reformulacion: 2, senalamiento: 1 },
      observacionIA: null,
      progresoPercibido: "Sostiene el encuadre.",
    });

    // Una sesión sin datos no rompe: sale con todo en null.
    expect(resultado.sesiones[1].intensidadEmocional).toBeNull();
    expect(resultado.sesiones[1].alianzaTerapeutica).toBeNull();
    expect(resultado.sesiones[1].temas).toEqual([]);
    expect(resultado.sesiones[1].intervenciones).toEqual({});
  });

  it("una fila sin datos estructurados entra igual en la serie", () => {
    const resultado = progreso([sesion("s1", diasAntes(3), null)]);

    expect(resultado.sesiones).toHaveLength(1);
    expect(resultado.sesiones[0].nivelRiesgo).toBeNull();
  });
});

describe("armarProgresoClinico — temas", () => {
  it("cuenta una vez por sesión aunque el tema se repita en ella", () => {
    const resultado = progreso([
      sesion("s1", diasAntes(14), { temas: ["madre", "madre", " madre "] }),
      sesion("s2", diasAntes(7), { temas: ["madre"] }),
    ]);

    const madre = resultado.temas.find((t) => t.tema === "madre");
    expect(madre?.conteo).toBe(2);
    expect(madre?.deTotal).toBe(2);
  });

  it("guarda primera y última vez", () => {
    const primera = diasAntes(60);
    const ultima = diasAntes(7);
    const resultado = progreso([
      sesion("s1", primera, { temas: ["duelo"] }),
      sesion("s2", diasAntes(30), { temas: ["trabajo"] }),
      sesion("s3", ultima, { temas: ["duelo"] }),
    ]);

    const duelo = resultado.temas.find((t) => t.tema === "duelo");
    expect(duelo?.primeraVez).toBe(primera.toISOString());
    expect(duelo?.ultimaVez).toBe(ultima.toISOString());
  });

  it("los temas salen de TODAS las sesiones, no del rango", () => {
    const sesiones = [
      sesion("vieja", diasAntes(300), { temas: ["infancia"] }),
      sesion("reciente", diasAntes(3), { temas: ["trabajo"] }),
    ];

    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones,
      rango: "3m",
      ahora: AHORA,
    });

    expect(resultado.sesiones).toHaveLength(1);
    expect(resultado.temas.map((t) => t.tema).sort()).toEqual([
      "infancia",
      "trabajo",
    ]);
  });

  it("ordena por conteo y corta en 15", () => {
    // 20 temas distintos, uno por sesión, más "constante" en todas.
    const sesiones = semanales(20, (i) => [`tema${i}`, "constante"]);
    const resultado = progreso(sesiones);

    expect(resultado.temas).toHaveLength(15);
    expect(resultado.temas[0].tema).toBe("constante");
    expect(resultado.temas[0].conteo).toBe(20);
  });

  describe("tendencia", () => {
    it("con 5 sesiones o menos todo es nuevo: no hay contra qué comparar", () => {
      const resultado = progreso(semanales(4, () => ["duelo"]));

      expect(resultado.temas[0].tendencia).toBe("nuevo");
    });

    it("nuevo: apareció solo dentro de las últimas 5", () => {
      const sesiones = semanales(10, (i) => (i >= 7 ? ["mudanza"] : ["duelo"]));
      const resultado = progreso(sesiones);

      expect(resultado.temas.find((t) => t.tema === "mudanza")?.tendencia).toBe(
        "nuevo",
      );
    });

    it("sube: se toca más seguido en las últimas 5 que antes", () => {
      // Antes: 1 de 5. Ahora: 5 de 5.
      const sesiones = semanales(10, (i) =>
        i === 0 || i >= 5 ? ["pareja"] : [],
      );
      const resultado = progreso(sesiones);

      expect(resultado.temas.find((t) => t.tema === "pareja")?.tendencia).toBe(
        "sube",
      );
    });

    it("baja: era frecuente y casi no vuelve", () => {
      // Antes: 5 de 5. Ahora: 1 de 5.
      const sesiones = semanales(10, (i) =>
        i < 5 || i === 9 ? ["trabajo"] : [],
      );
      const resultado = progreso(sesiones);

      expect(resultado.temas.find((t) => t.tema === "trabajo")?.tendencia).toBe(
        "baja",
      );
    });

    it("estable: la misma frecuencia antes y ahora", () => {
      const sesiones = semanales(10, () => ["cuerpo"]);
      const resultado = progreso(sesiones);

      expect(resultado.temas.find((t) => t.tema === "cuerpo")?.tendencia).toBe(
        "estable",
      );
    });
  });
});

describe("armarProgresoClinico — riesgos", () => {
  it("una entrada por flag activo, con nivel y cita", () => {
    const fecha = diasAntes(20);
    const resultado = progreso([
      sesion("s1", fecha, {
        flagsRiesgo: {
          ...sinFlags(),
          ideacionSuicida: true,
          autolesion: true,
          detalle: "lo dijo al final",
        },
        riesgoDetectado: {
          nivel: "alto",
          indicadores: ["ideación"],
          evidencia: [{ timestamp: "40:12", quote: "no quiero seguir" }],
          notaParaTerapeuta: "Consultar guardia.",
        },
      }),
    ]);

    expect(resultado.riesgos).toEqual([
      {
        sesionId: "s1",
        fecha: fecha.toISOString(),
        flag: "ideacionSuicida",
        nivel: "alto",
        cita: "no quiero seguir",
      },
      {
        sesionId: "s1",
        fecha: fecha.toISOString(),
        flag: "autolesion",
        nivel: "alto",
        cita: "no quiero seguir",
      },
    ]);
  });

  it("sin evidencia citada usa el detalle de los flags", () => {
    const resultado = progreso([
      sesion("s1", diasAntes(5), {
        flagsRiesgo: {
          ...sinFlags(),
          crisisPanico: true,
          detalle: "dos episodios esta semana",
        },
      }),
    ]);

    expect(resultado.riesgos[0].cita).toBe("dos episodios esta semana");
    expect(resultado.riesgos[0].nivel).toBeNull();
  });

  it("sin evidencia ni detalle la cita es null, no un string vacío", () => {
    const resultado = progreso([
      sesion("s1", diasAntes(5), {
        flagsRiesgo: { ...sinFlags(), autolesion: true },
      }),
    ]);

    expect(resultado.riesgos[0].cita).toBeNull();
  });

  it("sin ningún flag activo no hay entradas, aunque haya nivel graduado", () => {
    const resultado = progreso([
      sesion("s1", diasAntes(5), {
        flagsRiesgo: sinFlags(),
        riesgoDetectado: {
          nivel: "moderado",
          indicadores: ["desesperanza"],
          evidencia: [],
          notaParaTerapeuta: null,
        },
      }),
    ]);

    expect(resultado.riesgos).toEqual([]);
    // El nivel igual se ve en la serie de sesiones.
    expect(resultado.sesiones[0].nivelRiesgo).toBe("moderado");
  });

  it("los riesgos son de todas las sesiones y van en orden cronológico", () => {
    const sesiones = [
      sesion("vieja", diasAntes(300), {
        flagsRiesgo: { ...sinFlags(), autolesion: true },
      }),
      sesion("reciente", diasAntes(2), {
        flagsRiesgo: { ...sinFlags(), crisisPanico: true },
      }),
    ];

    const resultado = armarProgresoClinico({
      pacienteId: "pac1",
      sesiones,
      rango: "10s",
      ahora: AHORA,
    });

    expect(resultado.riesgos.map((r) => r.sesionId)).toEqual([
      "vieja",
      "reciente",
    ]);
  });
});
