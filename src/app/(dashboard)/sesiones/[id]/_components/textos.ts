// Textos de la pantalla de sesión.
//
// Regla: una palabra por concepto, y el concepto se nombra donde ya está
// nombrado — src/lib/glosario.ts. La primera mitad de este módulo es un
// re-export de ese glosario para que los componentes de la ruta importen de
// un solo lugar.
//
// La segunda mitad ("PENDIENTE DE MUDARSE A glosario.ts") son los textos que
// esta pantalla necesita y que el glosario todavía no tiene. Viven acá, con
// el mismo nombre que tendrían allá, porque el agente que escribió esta ruta
// no tiene permiso de edición sobre glosario.ts. Mudarlos es mover el bloque
// y cambiar este archivo por un re-export más.

import type { NotaSoap } from "@/lib/sesion-clinica/schema";

export {
  ALGO_FALLO,
  APARECIO_POR_PRIMERA_VEZ,
  CTSR,
  ESCRIBIENDO_NOTA,
  GTFS,
  LO_QUE_DIJO,
  MAS_DE_ESTA_SESION,
  MITI,
  NOTA_CLINICA,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  PARA_LA_PROXIMA,
  PARA_REVISAR,
  PARA_VOS,
  REVISE_ESTA_SENAL,
  SE_LLEVO,
  SENAL_DE_RIESGO,
  VUELVE_A_APARECER,
  pluralizar,
} from "@/lib/glosario";

import {
  NOTA_GUARDADA,
  PARA_REVISAR,
  SOAP_A,
  SOAP_O,
  SOAP_P,
  SOAP_S,
} from "@/lib/glosario";

/**
 * Las cuatro secciones SOAP con la clave de la nota que edita cada una.
 * glosario.SOAP_SECCIONES tiene el mismo orden pero no las claves: la nota
 * es un objeto, no una lista, y la pantalla necesita saber qué campo escribe
 * cada sección. Nombre y letra salen del glosario, sin excepción.
 */
export const SECCIONES_SOAP: ReadonlyArray<{
  clave: keyof NotaSoap;
  titulo: string;
  ayuda: string;
}> = [
  { clave: "subjetivo", ...SOAP_S },
  { clave: "objetivo", ...SOAP_O },
  { clave: "analisis", ...SOAP_A },
  { clave: "plan", ...SOAP_P },
];

// ────────────────────────────────────────────────────────────────────────────
// PENDIENTE DE MUDARSE A glosario.ts
// ────────────────────────────────────────────────────────────────────────────

/** Chip de la cabecera cuando la nota todavía no se aprobó. Es el mismo
 *  concepto que glosario.PARA_REVISAR: no se agrega un cuarto nombre para el
 *  estado que ya tiene tres en el código viejo. */
export const CHIP_BORRADOR = PARA_REVISAR;

/** Chip de la cabecera cuando la nota ya se aprobó (glosario.NOTA_GUARDADA). */
export const CHIP_APROBADA = NOTA_GUARDADA;

/** Plegado con notaSoapOriginal: la nota tal como la escribió el modelo,
 *  antes de que ella la tocara. */
export const VER_BORRADOR_ORIGINAL = "Ver el borrador original";

/** Resumen de la sesión, arriba de la nota. */
export const RESUMEN = "Resumen";

/** Cómo se llamaba antes el estado emocional que observó la terapeuta. */
export const ESTADO_EMOCIONAL_OBSERVADO = "Estado emocional observado";

/** Abre la edición de una sección SOAP. Visible siempre, además del toque
 *  sobre el texto: el toque no existe para quien navega con teclado. */
export const EDITAR = "Editar";

/** Abre los ítems de un instrumento de auto-supervisión. */
export const VER_DETALLE = "Ver detalle";

export const DESCARTAR = "Descartar";
export const APROBAR_NOTA = "✓ Aprobar nota";
export const APROBANDO = "Aprobando…";
export const REINTENTAR = "Reintentar";
export const REINTENTANDO = "Reintentando…";
export const ELIMINAR = "Eliminar";
export const ELIMINANDO = "Eliminando…";
export const VOLVER = "Volver";

/** Confirmación de descarte: dice qué se pierde y qué se conserva. */
export const DESCARTAR_TITULO = "¿Descartar esta nota?";
export const DESCARTAR_MENSAJE =
  "Se puede deshacer: la sesión vuelve a error y la podés volver a escribir. Se descarta la nota generada; la transcripción y el audio se conservan.";
export const DESCARTANDO = "Descartando…";

/** Confirmación de aprobación: el audio se va para siempre. */
export const APROBAR_TITULO = "¿Aprobar esta nota?";
export const APROBAR_MENSAJE =
  "El audio de la sesión se borra definitivamente y la nota queda como registro. Esto no se puede deshacer.";

/** Confirmación de borrado definitivo desde el estado de error. */
export const ELIMINAR_TITULO = "¿Eliminar esta sesión?";
export const ELIMINAR_MENSAJE =
  "Se borran la sesión y su audio. No queda registro y no se puede deshacer.";

/** Por qué "Aprobar nota" está deshabilitado. */
export const FALTA_REVISAR_RIESGO =
  "Marcá cada señal de riesgo antes de aprobar la nota.";

/** La sesión existe pero todavía no llegó a tener nota (pendiente, grabando). */
export const SIN_NOTA_TODAVIA = "Esta sesión todavía no tiene nota.";

/** Carga de la pantalla. */
export const ABRIENDO_NOTA = "Abriendo la nota…";

// Rótulos de "Más de esta sesión". Son vocabulario del oficio y se dicen
// completos.
export const TEMAS = "Temas";
export const EMOCIONES = "Emociones";
export const INTERVENCIONES = "Intervenciones";
export const INTENSIDAD_EMOCIONAL = "Intensidad emocional";
export const ALIANZA_TERAPEUTICA = "Alianza terapéutica";
