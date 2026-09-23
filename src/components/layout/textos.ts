// Textos propios de la franja de avisos de notas y del globito de Hoy.
//
// Los de un solo aviso ya estaban en el glosario y se comparten con otras
// pantallas (notaListaDe, notaFallidaDe, REVISAR, VER_QUE_PASO); acá va solo
// lo que dice el panel cuando hay más de uno.

/** Nombre de la región de la franja, para quien usa lector de pantalla. */
export const REGION_AVISOS = "Avisos de notas";

function notas(n: number): string {
  return n === 1 ? "1 nota" : `${n} notas`;
}

/**
 * El renglón de la franja con varios avisos: primero lo listo, después lo
 * que falló, con los números.
 *   2 notas listas · 2 notas que no pudimos escribir ·
 *   1 nota lista y 1 que no pudimos escribir
 */
export function resumenDeAvisos(listas: number, fallidas: number): string {
  if (fallidas === 0) return `${notas(listas)} ${listas === 1 ? "lista" : "listas"}`;
  if (listas === 0) return `${notas(fallidas)} que no pudimos escribir`;
  return `${notas(listas)} ${listas === 1 ? "lista" : "listas"} y ${fallidas} que no pudimos escribir`;
}

/** Los nombres debajo del resumen: "Lucía Fernández y Ana Pérez",
 *  "Lucía Fernández, Ana Pérez y Marta Silva". */
export function nombresDeAvisos(pacientes: string[]): string {
  if (pacientes.length <= 1) return pacientes.join("");
  return `${pacientes.slice(0, -1).join(", ")} y ${pacientes[pacientes.length - 1]}`;
}

/** Despliega y pliega la lista de avisos. */
export const VER_AVISOS = "Ver";
export const OCULTAR_AVISOS = "Ocultar";

/** Lo que el lector de pantalla dice del globito de Hoy. */
export function avisosEnHoy(n: number): string {
  return n === 1 ? "1 nota para mirar" : `${n} notas para mirar`;
}
