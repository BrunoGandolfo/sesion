// Los esqueletos de pantalla. Uno por pantalla, dos consumos cada uno: su
// `loading.tsx` y la rama "cargando" de su componente cliente.
// Ver la cabecera de base.tsx.

export { Esqueleto, FilaHueco, Hueco, TARJETA } from "./base";
export type { TonoHueco } from "./base";

export { EsqueletoHoy } from "./hoy";
export { EsqueletoPacientes, EsqueletoListaPacientes } from "./pacientes";
export { EsqueletoCobros, EsqueletoCobrosCuerpo } from "./cobros";
export { EsqueletoNota, EsqueletoNotaCuerpo } from "./nota";
export { EsqueletoPantalla } from "./pantalla";
