// Las dos decisiones automáticas del grabador, en aislamiento.
//
// Este archivo es el que hubiera atrapado lo del 7/9. La regla que prueba no
// es "el número es 9000": es que llegar al tope NO significa completar. Por
// eso `estadoLimite` devuelve "limite" y no "terminar", y por eso el caso que
// más importa está escrito abajo con todas las letras.
//
// Los umbrales se prueban en su valor exacto y en el segundo de antes: un
// umbral que se corre un segundo no rompe ningún test si solo se prueban
// valores redondos, y acá un segundo de más es media hora de sesión perdida.

import { describe, expect, it } from "vitest";

import {
  AVISO_LIMITE_SEGUNDOS,
  estadoCaptura,
  estadoLimite,
  LIMITE_SEGUNDOS,
  segundosRestantes,
  SILENCIO_OCULTA_INTERRUMPIR_SEG,
  SILENCIO_VISIBLE_AVISO_SEG,
  SILENCIO_VISIBLE_INTERRUMPIR_SEG,
} from "@/lib/grabacion-captura";

const VISIBLE = true;
const OCULTA = false;

describe("estadoCaptura, con la pantalla a la vista", () => {
  it("sin silencio está ok", () => {
    expect(estadoCaptura(0, VISIBLE)).toBe("ok");
  });

  it("un silencio de sesión no es un problema", () => {
    // Minuto y medio callados es trabajo clínico, no un micrófono roto.
    expect(estadoCaptura(90, VISIBLE)).toBe("ok");
  });

  it("avisa recién a los 2 minutos exactos", () => {
    expect(estadoCaptura(SILENCIO_VISIBLE_AVISO_SEG - 1, VISIBLE)).toBe("ok");
    expect(estadoCaptura(SILENCIO_VISIBLE_AVISO_SEG, VISIBLE)).toBe("aviso");
  });

  it("entre el aviso y el corte sigue avisando, no corta", () => {
    expect(estadoCaptura(200, VISIBLE)).toBe("aviso");
    expect(estadoCaptura(SILENCIO_VISIBLE_INTERRUMPIR_SEG - 1, VISIBLE)).toBe(
      "aviso",
    );
  });

  it("interrumpe recién a los 5 minutos exactos", () => {
    expect(estadoCaptura(SILENCIO_VISIBLE_INTERRUMPIR_SEG, VISIBLE)).toBe(
      "interrumpir",
    );
    expect(estadoCaptura(3600, VISIBLE)).toBe("interrumpir");
  });
});

describe("estadoCaptura, con la pantalla apagada", () => {
  it("sin silencio está ok", () => {
    expect(estadoCaptura(0, OCULTA)).toBe("ok");
  });

  it("interrumpe recién al minuto exacto", () => {
    expect(estadoCaptura(SILENCIO_OCULTA_INTERRUMPIR_SEG - 1, OCULTA)).toBe(
      "ok",
    );
    expect(estadoCaptura(SILENCIO_OCULTA_INTERRUMPIR_SEG, OCULTA)).toBe(
      "interrumpir",
    );
  });

  it("nunca avisa: un cartel que nadie puede leer no es una decisión", () => {
    for (const silencio of [0, 30, 59, 60, 120, 300, 5400]) {
      expect(estadoCaptura(silencio, OCULTA)).not.toBe("aviso");
    }
  });

  it("es más severa que con la pantalla a la vista, no menos", () => {
    // A los 60 s: oculta corta, visible ni siquiera avisa. Es la asimetría
    // del 7/9 — con la pantalla apagada el silencio no es de la paciente.
    expect(estadoCaptura(60, OCULTA)).toBe("interrumpir");
    expect(estadoCaptura(60, VISIBLE)).toBe("ok");
  });
});

describe("estadoCaptura, bordes", () => {
  it("un silencio negativo se trata como cero", () => {
    expect(estadoCaptura(-10, VISIBLE)).toBe("ok");
    expect(estadoCaptura(-10, OCULTA)).toBe("ok");
  });

  it("devuelve siempre uno de los tres estados", () => {
    for (const visible of [VISIBLE, OCULTA]) {
      for (const silencio of [0, 1, 119, 120, 299, 300, 10_000]) {
        expect(["ok", "aviso", "interrumpir"]).toContain(
          estadoCaptura(silencio, visible),
        );
      }
    }
  });
});

describe("estadoLimite", () => {
  it("el tope son 150 minutos y el aviso 135", () => {
    expect(LIMITE_SEGUNDOS).toBe(150 * 60);
    expect(AVISO_LIMITE_SEGUNDOS).toBe(135 * 60);
  });

  it("una sesión normal no dispara nada", () => {
    expect(estadoLimite(0)).toBe("ok");
    expect(estadoLimite(50 * 60)).toBe("ok");
  });

  it("avisa recién a los 135 minutos exactos", () => {
    expect(estadoLimite(AVISO_LIMITE_SEGUNDOS - 1)).toBe("ok");
    expect(estadoLimite(AVISO_LIMITE_SEGUNDOS)).toBe("aviso");
  });

  it("entre el aviso y el tope sigue avisando", () => {
    expect(estadoLimite(LIMITE_SEGUNDOS - 1)).toBe("aviso");
  });

  it("corta recién a los 150 minutos exactos", () => {
    expect(estadoLimite(LIMITE_SEGUNDOS)).toBe("limite");
    expect(estadoLimite(LIMITE_SEGUNDOS + 500)).toBe("limite");
  });

  it("la sesión de 120 minutos del 7/9 hoy no dispara nada", () => {
    // El caso que rompió: 120 minutos reales. Con el tope viejo (5400) esto
    // completaba y subía a los 90; ahora ni siquiera avisa.
    expect(estadoLimite(120 * 60)).toBe("ok");
  });

  it("el aviso llega con 15 minutos de anticipación", () => {
    expect(LIMITE_SEGUNDOS - AVISO_LIMITE_SEGUNDOS).toBe(15 * 60);
  });
});

describe("segundosRestantes", () => {
  it("cuenta lo que falta para el tope", () => {
    expect(segundosRestantes(0)).toBe(LIMITE_SEGUNDOS);
    expect(segundosRestantes(AVISO_LIMITE_SEGUNDOS)).toBe(15 * 60);
  });

  it("nunca es negativo", () => {
    expect(segundosRestantes(LIMITE_SEGUNDOS)).toBe(0);
    expect(segundosRestantes(LIMITE_SEGUNDOS + 1000)).toBe(0);
  });
});
