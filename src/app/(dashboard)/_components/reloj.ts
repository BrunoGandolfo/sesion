// El reloj de Hoy, inyectable. En producción es la hora del sistema; los
// tests lo fijan con vi.useFakeTimers + setSystemTime (__tests__/reloj-fijo.ts)
// o pasan el suyo al Dashboard (prop `hora`). Sin esto, un test que cruzaba el cambio de
// minuto REAL veía avanzar el reloj a la fecha de hoy y la pantalla dejaba de
// ser la de su lectura fija.

export type Reloj = () => Date;

export const relojDelSistema: Reloj = () => new Date();
