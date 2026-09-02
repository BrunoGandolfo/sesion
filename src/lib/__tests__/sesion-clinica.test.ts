import { describe, it, expect } from "vitest";

// Se importa la parte pura (sin @/lib/db) para que el test corra sin base.
import {
  DETALLE_MAX_STRING,
  detalleSeguro,
  hashTexto,
} from "@/app/api/_lib/auditoria-pura";
import {
  esKeyAudioDeSesion,
  esTransicionPermitidaAlCliente,
  esTransicionValida,
  keyAudioEsperada,
  parseDatosEstructurados,
  esNotaCompleta,
} from "@/lib/sesion-clinica-utils";
import type {
  AlianzaTerapeutica,
  DatosEstructurados,
  EstadoProcesamiento,
  IntervencionTerapeuta,
} from "@/types/domain";

const TODOS_LOS_ESTADOS: EstadoProcesamiento[] = [
  "pendiente",
  "grabando",
  "subiendo",
  "procesando",
  "revision",
  "aprobado",
  "error",
];

describe("Sesión clínica - validaciones", () => {
  // ─── Tabla del SISTEMA: lo que alguna ruta (PATCH, upload, callback,
  // aprobar o DELETE) puede hacer. ───────────────────────────────────────
  describe("esTransicionValida — transiciones válidas a nivel sistema", () => {
    const valid: Array<[EstadoProcesamiento, EstadoProcesamiento]> = [
      ["pendiente", "grabando"],
      ["grabando", "subiendo"],
      ["grabando", "procesando"], // upload salta "subiendo"
      ["grabando", "error"], // fallo de upload / huérfana con audio
      ["subiendo", "procesando"], // upload-confirmar (HeadObject OK)
      ["subiendo", "grabando"], // reintento de subida (PUT o confirmación fallaron)
      ["subiendo", "error"],
      ["procesando", "revision"], // callback
      ["procesando", "error"], // callback o tope de reintentos
      ["revision", "aprobado"], // solo /aprobar
      ["revision", "error"], // descarte (DELETE)
      ["error", "procesando"], // reintento
    ];

    it.each(valid)("permite %s → %s", (desde, hasta) => {
      expect(esTransicionValida(desde, hasta)).toBe(true);
    });
  });

  describe("esTransicionValida — transiciones inválidas a nivel sistema", () => {
    it("rechaza pendiente → procesando (saltea grabando)", () => {
      expect(esTransicionValida("pendiente", "procesando")).toBe(false);
    });

    it("rechaza pendiente → revision", () => {
      expect(esTransicionValida("pendiente", "revision")).toBe(false);
    });

    it("rechaza grabando → revision (no se puede saltar el procesamiento)", () => {
      expect(esTransicionValida("grabando", "revision")).toBe(false);
    });

    it("rechaza revision → grabando (no se vuelve a grabar)", () => {
      expect(esTransicionValida("revision", "grabando")).toBe(false);
    });

    it("revision solo puede ir a aprobado o error", () => {
      for (const destino of TODOS_LOS_ESTADOS) {
        const esperado = destino === "aprobado" || destino === "error";
        expect(esTransicionValida("revision", destino)).toBe(esperado);
      }
    });

    it("aprobado es terminal: rechaza cualquier transición", () => {
      for (const destino of TODOS_LOS_ESTADOS) {
        expect(esTransicionValida("aprobado", destino)).toBe(false);
      }
    });

    it("error no salta a revision sin re-procesar", () => {
      expect(esTransicionValida("error", "revision")).toBe(false);
    });

    it("rechaza un estado consigo mismo (no-op)", () => {
      expect(esTransicionValida("grabando", "grabando")).toBe(false);
    });

    it("rechaza estados desconocidos sin lanzar", () => {
      expect(esTransicionValida("corrupto", "grabando")).toBe(false);
      expect(esTransicionValida("grabando", "corrupto")).toBe(false);
    });
  });

  // ─── Tabla del CLIENTE: lo que el navegador puede pedir por PATCH
  // /api/sesion-clinica/[id] { estado }. Es un subconjunto estricto de la
  // tabla del sistema; el resto se hace por su ruta con efectos. ─────────
  describe("esTransicionPermitidaAlCliente — lo que el PATCH acepta", () => {
    const permitidas: Array<[EstadoProcesamiento, EstadoProcesamiento]> = [
      ["pendiente", "grabando"],
      ["grabando", "error"],
      ["subiendo", "grabando"], // reintento de subida directa a R2
      ["error", "procesando"],
    ];

    it.each(permitidas)("el cliente puede pedir %s → %s", (desde, hasta) => {
      expect(esTransicionPermitidaAlCliente(desde, hasta)).toBe(true);
    });

    it("el cliente no puede pedir grabando → subiendo (la hace el servidor en upload-url)", () => {
      expect(esTransicionValida("grabando", "subiendo")).toBe(true);
      expect(esTransicionPermitidaAlCliente("grabando", "subiendo")).toBe(
        false,
      );
    });

    it("el cliente no puede pedir revision → aprobado (solo /aprobar)", () => {
      expect(esTransicionValida("revision", "aprobado")).toBe(true);
      expect(esTransicionPermitidaAlCliente("revision", "aprobado")).toBe(
        false,
      );
    });

    it("el cliente no puede pedir grabando → procesando (solo /upload)", () => {
      expect(esTransicionValida("grabando", "procesando")).toBe(true);
      expect(esTransicionPermitidaAlCliente("grabando", "procesando")).toBe(
        false,
      );
    });

    it("el cliente no puede pedir subiendo → procesando (solo /upload)", () => {
      expect(esTransicionValida("subiendo", "procesando")).toBe(true);
      expect(esTransicionPermitidaAlCliente("subiendo", "procesando")).toBe(
        false,
      );
    });

    it("el cliente no puede pedir procesando → revision (solo callback)", () => {
      expect(esTransicionValida("procesando", "revision")).toBe(true);
      expect(esTransicionPermitidaAlCliente("procesando", "revision")).toBe(
        false,
      );
    });

    it("el cliente no puede pedir revision → error (solo DELETE)", () => {
      expect(esTransicionPermitidaAlCliente("revision", "error")).toBe(false);
    });

    it("nunca permite lo que el sistema tampoco permite", () => {
      for (const desde of TODOS_LOS_ESTADOS) {
        for (const hasta of TODOS_LOS_ESTADOS) {
          if (!esTransicionValida(desde, hasta)) {
            expect(esTransicionPermitidaAlCliente(desde, hasta)).toBe(false);
          }
        }
      }
    });

    it("exactamente cuatro transiciones son de cliente", () => {
      let total = 0;
      for (const desde of TODOS_LOS_ESTADOS) {
        for (const hasta of TODOS_LOS_ESTADOS) {
          if (esTransicionPermitidaAlCliente(desde, hasta)) total += 1;
        }
      }
      expect(total).toBe(4);
    });
  });

  // ─── Key del audio en R2: determinística por sesión; upload-confirmar
  // solo acepta la que coincide, nunca una key arbitraria del cliente. ────
  describe("keyAudioEsperada / esKeyAudioDeSesion", () => {
    it("arma audio/<org>/<sesion>/<turno>.enc", () => {
      expect(keyAudioEsperada("org1", "ses1", "tur1")).toBe(
        "audio/org1/ses1/tur1.enc",
      );
    });

    it("acepta solo la key exacta de la sesión", () => {
      expect(
        esKeyAudioDeSesion("audio/org1/ses1/tur1.enc", "org1", "ses1", "tur1"),
      ).toBe(true);
    });

    it("rechaza keys de otra sesión, otra org u otro turno", () => {
      expect(
        esKeyAudioDeSesion("audio/org1/ses2/tur1.enc", "org1", "ses1", "tur1"),
      ).toBe(false);
      expect(
        esKeyAudioDeSesion("audio/org2/ses1/tur1.enc", "org1", "ses1", "tur1"),
      ).toBe(false);
      expect(
        esKeyAudioDeSesion("audio/org1/ses1/tur2.enc", "org1", "ses1", "tur1"),
      ).toBe(false);
    });

    it("rechaza prefijos, sufijos, traversal y no-strings", () => {
      expect(
        esKeyAudioDeSesion("audio/org1/ses1/tur1.enc/x", "org1", "ses1", "tur1"),
      ).toBe(false);
      expect(
        esKeyAudioDeSesion("../audio/org1/ses1/tur1.enc", "org1", "ses1", "tur1"),
      ).toBe(false);
      expect(esKeyAudioDeSesion(null, "org1", "ses1", "tur1")).toBe(false);
      expect(esKeyAudioDeSesion(42, "org1", "ses1", "tur1")).toBe(false);
    });
  });

  describe("parseDatosEstructurados", () => {
    const intervencionBase: IntervencionTerapeuta = {
      tipo: "validacion",
      descripcion: "Valida la angustia y ordena la secuencia del relato.",
      timestampAprox: "12:34",
    };

    const validoBase: DatosEstructurados = {
      temas: ["ansiedad", "trabajo"],
      emocionesPaciente: ["frustración"],
      intensidadEmocional: 7,
      alianzaTerapeutica: "estable",
      intervenciones: [intervencionBase],
      compromisos: ["registro diario"],
      materialRecurrente: ["exigencia laboral"],
      materialNuevo: ["conflicto con supervisión"],
      focoProximaSesion: "Explorar autoexigencia y anticipación ansiosa.",
      flagsRiesgo: {
        ideacionSuicida: false,
        autolesion: false,
        violenciaTerceros: false,
        sintomasPsicoticos: false,
        crisisPanico: false,
        detalle: "",
      },
      confianzaModelo: "media",
      resumenSesion:
        "Se trabajó sobre ansiedad laboral, con registro de disparadores y validación afectiva.",
      estadoEmocionalObservado:
        "Se observó tono ansioso con momentos de alivio al ordenar la secuencia.",
      duracionRealMin: 50,
      progresoPercibido: "leve mejora",
    };

    it("parsea JSON válido y devuelve los datos", () => {
      const result = parseDatosEstructurados(JSON.stringify(validoBase));
      expect(result).toEqual(validoBase);
    });

    it("acepta intensidad en los bordes (1 y 10)", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, intensidadEmocional: 1 }),
        ),
      ).not.toBeNull();
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, intensidadEmocional: 10 }),
        ),
      ).not.toBeNull();
    });

    it("rechaza intensidadEmocional < 1", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, intensidadEmocional: 0 }),
        ),
      ).toBeNull();
    });

    it("rechaza intensidadEmocional > 10", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, intensidadEmocional: 11 }),
        ),
      ).toBeNull();
    });

    it("rechaza intensidadEmocional no numérica", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, intensidadEmocional: "alta" }),
        ),
      ).toBeNull();
    });

    it("rechaza intensidadEmocional NaN/Infinity", () => {
      const conNaN = `{"temas":[],"emocionesPaciente":[],"intensidadEmocional":NaN,"alianzaTerapeutica":"estable","intervenciones":[],"compromisos":[],"materialRecurrente":[],"materialNuevo":[],"focoProximaSesion":"","flagsRiesgo":{"ideacionSuicida":false,"autolesion":false,"violenciaTerceros":false,"sintomasPsicoticos":false,"crisisPanico":false,"detalle":""},"confianzaModelo":"media","resumenSesion":"","estadoEmocionalObservado":"","duracionRealMin":50,"progresoPercibido":""}`;
      // NaN no es JSON válido, el parser falla
      expect(parseDatosEstructurados(conNaN)).toBeNull();
    });

    it("acepta cada alianza terapéutica válida", () => {
      const alianzas: AlianzaTerapeutica[] = [
        "fragil",
        "inestable",
        "estable",
        "fuerte",
      ];
      for (const alianza of alianzas) {
        const result = parseDatosEstructurados(
          JSON.stringify({ ...validoBase, alianzaTerapeutica: alianza }),
        );
        expect(result?.alianzaTerapeutica).toBe(alianza);
      }
    });

    it("rechaza alianza terapéutica inválida", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, alianzaTerapeutica: "rota" }),
        ),
      ).toBeNull();
    });

    it("devuelve null para JSON malformado", () => {
      expect(parseDatosEstructurados("{ no es json")).toBeNull();
      expect(parseDatosEstructurados("undefined")).toBeNull();
    });

    it("devuelve null para entrada null", () => {
      expect(parseDatosEstructurados(null)).toBeNull();
    });

    it("devuelve null para string vacío o whitespace", () => {
      expect(parseDatosEstructurados("")).toBeNull();
      expect(parseDatosEstructurados("   ")).toBeNull();
    });

    it("devuelve null si JSON parsea a primitivo", () => {
      expect(parseDatosEstructurados("123")).toBeNull();
      expect(parseDatosEstructurados('"texto"')).toBeNull();
      expect(parseDatosEstructurados("null")).toBeNull();
      expect(parseDatosEstructurados("true")).toBeNull();
    });

    it("devuelve null si falta un campo obligatorio (temas)", () => {
      const obj: Partial<DatosEstructurados> = { ...validoBase };
      delete obj.temas;
      expect(parseDatosEstructurados(JSON.stringify(obj))).toBeNull();
    });

    it("devuelve null si un array contiene elementos no-string", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, temas: ["ok", 42] }),
        ),
      ).toBeNull();
    });

    it("acepta intervenciones como objetos tipados", () => {
      const result = parseDatosEstructurados(JSON.stringify(validoBase));
      expect(result?.intervenciones).toEqual([intervencionBase]);
    });

    it("rechaza intervenciones con tipo inválido", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({
            ...validoBase,
            intervenciones: [
              {
                ...intervencionBase,
                tipo: "psicoeducacion",
              },
            ],
          }),
        ),
      ).toBeNull();
    });

    it("rechaza intervenciones con timestampAprox inválido", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({
            ...validoBase,
            intervenciones: [
              {
                ...intervencionBase,
                timestampAprox: "12:99",
              },
            ],
          }),
        ),
      ).toBeNull();
    });

    it("acepta flagsRiesgo completos", () => {
      const result = parseDatosEstructurados(
        JSON.stringify({
          ...validoBase,
          flagsRiesgo: {
            ideacionSuicida: true,
            autolesion: false,
            violenciaTerceros: false,
            sintomasPsicoticos: false,
            crisisPanico: true,
            detalle: "Refiere ideas de muerte sin plan y episodio agudo de pánico.",
          },
        }),
      );

      expect(result?.flagsRiesgo).toEqual({
        ideacionSuicida: true,
        autolesion: false,
        violenciaTerceros: false,
        sintomasPsicoticos: false,
        crisisPanico: true,
        detalle: "Refiere ideas de muerte sin plan y episodio agudo de pánico.",
      });
    });

    it("rechaza flagsRiesgo incompletos", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({
            ...validoBase,
            flagsRiesgo: {
              ideacionSuicida: false,
              autolesion: false,
              violenciaTerceros: false,
              sintomasPsicoticos: false,
              detalle: "",
            },
          }),
        ),
      ).toBeNull();
    });

    it("rechaza confianzaModelo inválida", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, confianzaModelo: "incierta" }),
        ),
      ).toBeNull();
    });

    it("rechaza duracionRealMin negativa", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, duracionRealMin: -1 }),
        ),
      ).toBeNull();
    });

    it("devuelve null si progresoPercibido no es string", () => {
      expect(
        parseDatosEstructurados(
          JSON.stringify({ ...validoBase, progresoPercibido: null }),
        ),
      ).toBeNull();
    });
  });

  describe("esNotaCompleta", () => {
    const completa = {
      subjetivo: "Refiere ansiedad ante situaciones laborales.",
      objetivo: "Tono ansioso, contacto visual sostenido.",
      analisis: "Cuadro de ansiedad reactiva, alianza estable.",
      plan: "Continuar TCC, próxima sesión en una semana.",
    };

    it("devuelve true cuando los 4 campos tienen contenido", () => {
      expect(esNotaCompleta(completa)).toBe(true);
    });

    it("devuelve false cuando falta el plan", () => {
      expect(esNotaCompleta({ ...completa, plan: "" })).toBe(false);
    });

    it("devuelve false cuando falta subjetivo", () => {
      expect(esNotaCompleta({ ...completa, subjetivo: "" })).toBe(false);
    });

    it("devuelve false cuando un campo es solo whitespace", () => {
      expect(esNotaCompleta({ ...completa, analisis: "   \n\t " })).toBe(false);
    });

    it("devuelve false con objeto vacío", () => {
      expect(esNotaCompleta({})).toBe(false);
    });

    it("devuelve false con campos undefined", () => {
      expect(
        esNotaCompleta({ subjetivo: "x", objetivo: "x", analisis: "x" }),
      ).toBe(false);
    });
  });
});

describe("auditoría — detalleSeguro", () => {
  it("descarta las claves de la lista negra (texto clínico, PII, cripto)", () => {
    const out = detalleSeguro({
      nota: "texto clínico",
      transcripcion: "…",
      texto: "…",
      nombre: "Ana",
      apellido: "Pérez",
      telefono: "+598",
      email: "a@b.c",
      subjetivo: "…",
      objetivo: "…",
      analisis: "…",
      plan: "…",
      detalle: "…",
      quote: "…",
      resumen: "…",
      hipotesis: "…",
      datosEstructurados: "…",
      claveCifrado: "…",
      iv: "…",
      estado: "revision",
    });
    expect(out).toEqual({ estado: "revision" });
  });

  it("trunca strings de más de 120 caracteres", () => {
    const largo = "x".repeat(DETALLE_MAX_STRING + 50);
    const out = detalleSeguro({ modeloLLM: largo, corto: "ok" });
    expect((out?.modeloLLM as string).length).toBe(DETALLE_MAX_STRING);
    expect(out?.corto).toBe("ok");
  });

  it("descarta objetos anidados pero conserva arrays de primitivos", () => {
    const out = detalleSeguro({
      anidado: { subjetivo: "texto" },
      camposEnviados: ["hipotesisDiagnostica", "resumenAcumulativo"],
      mixto: ["a", { b: 1 }, 2, null],
    });
    expect(out).toEqual({
      camposEnviados: ["hipotesisDiagnostica", "resumenAcumulativo"],
      mixto: ["a", 2, null],
    });
    expect(out).not.toHaveProperty("anidado");
  });

  it("conserva number, boolean y null; descarta undefined y NaN", () => {
    const out = detalleSeguro({
      page: 2,
      audioBorrado: true,
      promptVersion: null,
      nada: undefined,
      nan: Number.NaN,
    });
    expect(out).toEqual({ page: 2, audioBorrado: true, promptVersion: null });
  });

  it("devuelve undefined si el detalle es undefined", () => {
    expect(detalleSeguro(undefined)).toBeUndefined();
  });

  it("no muta el objeto de entrada", () => {
    const entrada = { nota: "x", estado: "ok" };
    detalleSeguro(entrada);
    expect(entrada).toEqual({ nota: "x", estado: "ok" });
  });

  it("hashTexto es determinista y devuelve hex de 64 chars", () => {
    const a = hashTexto('{"subjetivo":"a"}');
    const b = hashTexto('{"subjetivo":"a"}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTexto('{"subjetivo":"b"}')).not.toBe(a);
  });
});
