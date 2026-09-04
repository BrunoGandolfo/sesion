// Textos del Recorrido que el glosario todavía no nombra.
//
// glosario.ts no es editable por el agente que rehízo esta pantalla, así que
// los rótulos nuevos viven acá, juntos y con el nombre que tendrían allá.
// Mudarlos es mover el bloque y cambiar este archivo por un re-export.
//
// Todo lo que YA está en el glosario se importa del glosario: COMO_VA,
// SENAL_DE_RIESGO, LO_QUE_DIJO, TEMAS, INTERVENCIONES, INTENSIDAD_EMOCIONAL,
// ALIANZA_TERAPEUTICA, VER_DETALLE, SENALES_ANTERIORES, REINTENTAR,
// ALGO_FALLO, pluralizar.

/** Rótulo del selector de rango. */
export const PERIODO = "Período";

/** Las cuatro opciones del selector, en el orden en que se muestran. */
export const RANGO_LABEL = {
  "10s": "Últimas 10",
  "3m": "3 meses",
  "6m": "6 meses",
  todo: "Todo",
} as const;

/** Card de la observación longitudinal generada por IA. */
export const OBSERVACION_IA = "Observación IA";

/** Card del progreso percibido de la última sesión del rango. */
export const PROGRESO_PERCIBIDO = "Progreso percibido";

/** Enlace desde una card o una señal a la nota de esa sesión. */
export const VER_LA_SESION = "Ver la sesión";

/** Tendencia de un tema dentro del rango. La flecha va con la palabra: sola
 *  no se entiende, y la palabra sola se pierde en la lista. */
export const TENDENCIA_LABEL = {
  nuevo: "nuevo",
  sube: "↑ sube",
  baja: "↓ baja",
  estable: "= estable",
} as const;

/** Prefijo de la primera aparición de un tema: "desde 4 mar". */
export const DESDE = "desde";

/** Subtítulos de cada gráfico. Explican qué se está mirando sin interpretar
 *  por ella. */
export const SUBTITULO_INTENSIDAD =
  "Cómo llegó a cada sesión, del 1 al 10. Los puntos en terracotta son sesiones con señal de riesgo.";
export const SUBTITULO_ALIANZA =
  "Calidad del vínculo en cada sesión. Las caídas en terracotta son posibles rupturas.";
export const SUBTITULO_TEMAS = "Qué se repite en el período elegido.";
export const SUBTITULO_INTERVENCIONES =
  "Cantidad y tipo de intervenciones en cada sesión del período.";
export const SUBTITULO_SENALES =
  "Todas las señales del período, por fecha. No se agrupan ni se ocultan.";

/** Estados vacíos. */
export const SIN_SESIONES_TITULO =
  "Todavía no hay sesiones para mirar en perspectiva.";
export const SIN_SESIONES_DETALLE =
  "Cuando grabes y apruebes las primeras sesiones, acá vas a ver cómo evoluciona el recorrido.";
export const POCO_RECORRIDO_TITULO = "Todavía no hay suficiente recorrido.";
export const POCO_RECORRIDO_DETALLE =
  "Los gráficos aparecen a partir de la tercera sesión grabada.";
export const DESDE_LA_TERCERA = "A partir de la tercera sesión";

/** El rango elegido no tiene ninguna sesión (pasa con "3 meses" en un
 *  proceso que estuvo en pausa). No es un error: es un período vacío. */
export const RANGO_SIN_SESIONES =
  "No hay sesiones en este período. Probá con uno más amplio.";

/** Dato ausente en una sesión: no se interpola ni se rellena con cero. */
export const SIN_DATO = "Sin dato";

/** Nota al pie de los gráficos con hueco. */
export const HUECOS_EXPLICADOS =
  "La línea se corta donde la sesión no registró el dato: no se completa por interpolación.";
