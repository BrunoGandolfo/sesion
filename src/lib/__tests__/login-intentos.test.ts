import { describe, expect, it } from "vitest";

import {
  BLOQUEOS_MIN,
  duracionBloqueoMin,
  elMasRestrictivo,
  evaluarBloqueo,
  MEMORIA_HORAS,
  UMBRAL_INTENTOS,
  VENTANA_MIN,
} from "@/lib/login-intentos";

// Instantes UTC explícitos: `new Date(2026, 8, 5, 18, 15)` usa la zona del
// proceso y este test tiene que decir lo mismo en la máquina de desarrollo
// que en CI.
const AHORA = new Date("2026-09-05T18:15:00.000Z");

const MS_MIN = 60_000;

/** `n` minutos antes de AHORA. */
function haceMin(n: number): Date {
  return new Date(AHORA.getTime() - n * MS_MIN);
}

/** `cantidad` fallos, uno por minuto, terminando `hace` minutos atrás. */
function fallosSeguidos(cantidad: number, hace = 0): Date[] {
  return Array.from({ length: cantidad }, (_, i) =>
    haceMin(hace + (cantidad - 1 - i)),
  );
}

describe("evaluarBloqueo — umbral", () => {
  it("sin fallos no bloquea", () => {
    expect(evaluarBloqueo([], AHORA)).toMatchObject({
      bloqueado: false,
      nivel: 0,
      hasta: null,
      fallos: 0,
    });
  });

  it("con un fallo menos que el umbral no bloquea", () => {
    const estado = evaluarBloqueo(fallosSeguidos(UMBRAL_INTENTOS - 1), AHORA);
    expect(estado.bloqueado).toBe(false);
    expect(estado.nivel).toBe(0);
  });

  it("al llegar al umbral dentro de la ventana bloquea", () => {
    const estado = evaluarBloqueo(fallosSeguidos(UMBRAL_INTENTOS), AHORA);
    expect(estado.bloqueado).toBe(true);
    expect(estado.nivel).toBe(1);
    expect(estado.fallos).toBe(UMBRAL_INTENTOS);
  });
});

describe("evaluarBloqueo — ventana", () => {
  it("los mismos 5 fallos repartidos en más de 15 minutos no bloquean", () => {
    // Uno cada 5 minutos: el tramo de los últimos cinco mide 20 minutos.
    const fallos = [
      haceMin(20),
      haceMin(15),
      haceMin(10),
      haceMin(5),
      haceMin(0),
    ];
    const estado = evaluarBloqueo(fallos, AHORA);
    expect(estado.bloqueado).toBe(false);
    // Los fallos siguen contados: no se borran, sólo no alcanzan el umbral
    // dentro de la ventana.
    expect(estado.fallos).toBe(5);
  });

  it("el bloqueo se mide desde el último fallo, no desde el primero", () => {
    const fallos = fallosSeguidos(UMBRAL_INTENTOS);
    const ultimo = fallos[fallos.length - 1];
    const estado = evaluarBloqueo(fallos, AHORA);
    expect(estado.hasta?.getTime()).toBe(
      ultimo.getTime() + BLOQUEOS_MIN[0] * MS_MIN,
    );
  });

  it("pasada la espera del nivel 1, el bloqueo se libera", () => {
    // Cinco fallos que terminaron hace 16 minutos: el bloqueo de 15 venció.
    const fallos = fallosSeguidos(UMBRAL_INTENTOS, VENTANA_MIN + 1);
    const estado = evaluarBloqueo(fallos, AHORA);
    expect(estado.bloqueado).toBe(false);
    expect(estado.nivel).toBe(1);
  });

  it("olvida los fallos de más de 24 horas", () => {
    const viejos = fallosSeguidos(UMBRAL_INTENTOS, MEMORIA_HORAS * 60 + 5);
    const estado = evaluarBloqueo(viejos, AHORA);
    expect(estado.fallos).toBe(0);
    expect(estado.bloqueado).toBe(false);
  });
});

describe("evaluarBloqueo — el bloqueo crece", () => {
  it("el segundo cruce del umbral espera más que el primero", () => {
    const primeraTanda = fallosSeguidos(UMBRAL_INTENTOS, 120);
    const segundaTanda = fallosSeguidos(UMBRAL_INTENTOS);
    const estado = evaluarBloqueo([...primeraTanda, ...segundaTanda], AHORA);

    expect(estado.nivel).toBe(2);
    expect(estado.bloqueado).toBe(true);
    const ultimo = segundaTanda[segundaTanda.length - 1];
    expect(estado.hasta?.getTime()).toBe(
      ultimo.getTime() + BLOQUEOS_MIN[1] * MS_MIN,
    );
    expect(BLOQUEOS_MIN[1]).toBeGreaterThan(BLOQUEOS_MIN[0]);
  });

  it("cada nivel espera al menos lo que el anterior", () => {
    for (let nivel = 2; nivel <= BLOQUEOS_MIN.length + 2; nivel++) {
      expect(duracionBloqueoMin(nivel)).toBeGreaterThanOrEqual(
        duracionBloqueoMin(nivel - 1),
      );
    }
  });

  it("la espera tiene techo: no crece hasta el infinito", () => {
    const ultimo = BLOQUEOS_MIN[BLOQUEOS_MIN.length - 1];
    expect(duracionBloqueoMin(BLOQUEOS_MIN.length)).toBe(ultimo);
    expect(duracionBloqueoMin(BLOQUEOS_MIN.length + 5)).toBe(ultimo);
  });

  it("nivel 0 no tiene espera", () => {
    expect(duracionBloqueoMin(0)).toBe(0);
    expect(duracionBloqueoMin(-1)).toBe(0);
  });
});

describe("evaluarBloqueo — el éxito no borra el historial", () => {
  // La política no recibe los logins exitosos: cuenta fallos y nada más. Que
  // el usuario haya entrado en el medio no aparece por ningún lado, así que
  // no puede limpiar el contador. Esto lo documenta y lo protege: si alguien
  // agregara "descartar los fallos anteriores al último éxito", estos dos
  // tests se rompen.
  it("cinco fallos siguen bloqueando aunque después se acierte", () => {
    const fallos = fallosSeguidos(UMBRAL_INTENTOS, 2);
    // El login exitoso ocurrió hace 1 minuto: no entra en la lista y no
    // cambia nada.
    expect(evaluarBloqueo(fallos, AHORA).bloqueado).toBe(true);
  });

  it("los fallos de antes de un éxito suman para el nivel siguiente", () => {
    const antesDelExito = fallosSeguidos(UMBRAL_INTENTOS, 300);
    const despues = fallosSeguidos(UMBRAL_INTENTOS);
    expect(evaluarBloqueo([...antesDelExito, ...despues], AHORA).nivel).toBe(2);
  });
});

describe("elMasRestrictivo", () => {
  const libre = evaluarBloqueo([], AHORA);
  const bloqueadoCorto = evaluarBloqueo(fallosSeguidos(UMBRAL_INTENTOS), AHORA);
  const bloqueadoLargo = evaluarBloqueo(
    fallosSeguidos(UMBRAL_INTENTOS * 2),
    AHORA,
  );

  it("bloquea si bloquea cualquiera de los dos", () => {
    expect(elMasRestrictivo(libre, bloqueadoCorto).bloqueado).toBe(true);
    expect(elMasRestrictivo(bloqueadoCorto, libre).bloqueado).toBe(true);
  });

  it("entre dos bloqueos se queda con el que termina más tarde", () => {
    expect(elMasRestrictivo(bloqueadoCorto, bloqueadoLargo).hasta).toEqual(
      bloqueadoLargo.hasta,
    );
    expect(elMasRestrictivo(bloqueadoLargo, bloqueadoCorto).hasta).toEqual(
      bloqueadoLargo.hasta,
    );
  });

  it("sin bloqueos conserva el nivel más alto, que es el que va a crecer", () => {
    const conHistoria = evaluarBloqueo(
      fallosSeguidos(UMBRAL_INTENTOS, VENTANA_MIN + 1),
      AHORA,
    );
    expect(elMasRestrictivo(libre, conHistoria).nivel).toBe(1);
  });
});
