// Los tests de Hoy no leen la hora real. Antes, un test que renderizaba el
// Dashboard y tardaba lo suficiente para cruzar el cambio de minuto REAL veía
// avanzar el reloj de la pantalla (dashboard.tsx, el tic de cada minuto) a la
// fecha de hoy, y la pantalla dejaba de ser la de su lectura fija: fallaba
// sólo cuando la suite iba lenta.
//
// relojFijo(instante) congela Date en `instante` para cada test del archivo.
// Sólo Date: los temporizadores siguen siendo los reales, porque findBy* y
// waitFor los usan. Un test que necesita mover el tiempo (hoy-reloj.test.tsx)
// falsea también los temporizadores por su cuenta.
//
// guardian-reloj.test.ts exige que todo test que renderiza en esta carpeta
// fije la hora, con esto o con setSystemTime.
import { afterEach, beforeEach, vi } from "vitest";

export function relojFijo(instante: Date): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instante);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
