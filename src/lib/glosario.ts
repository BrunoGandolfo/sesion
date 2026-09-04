// Glosario de la interfaz: una palabra por concepto, para toda la app.
//
// Por qué existe: hoy el mismo concepto se nombra de tres maneras según la
// pantalla ("Lista para revisar" en historia-tab, "Pendiente de aprobación"
// en la tarjeta de la timeline, "Nota lista para revisar" en el FAB), y el
// mismo estado de turno aparece como "Programado" y como "Agendado". Cada
// pantalla que muestre uno de estos conceptos toma el texto de acá.
//
// ─── REGLA CLÍNICA ──────────────────────────────────────────────────────
// Se simplifica el camino, nunca el contenido. Este módulo NO reemplaza
// vocabulario clínico: la nota sigue siendo una nota SOAP y sus cuatro
// secciones conservan su nombre y su letra; los instrumentos de
// auto-supervisión conservan su sigla (GTFS, MITI 4.2.1, CTS-R). Lo que
// agrega es una línea de ayuda al lado de cada término, para que se
// entienda sin dejar de llamarse como se llama.
//
// Los términos del oficio (alianza terapéutica, hipótesis diagnóstica,
// intensidad emocional, transferencia, señalamiento, confrontación,
// interpretación, pregunta circular) no se traducen ni se ablandan: son
// las palabras con las que la profesional piensa su trabajo.
//
// Módulo puro: solo strings. Lo puede importar cualquier componente
// cliente sin arrastrar dependencias.

// ────────────────────────────────────────────────────────────────────────────
// Navegación
// ────────────────────────────────────────────────────────────────────────────

/** Los cuatro destinos del menú, iguales en mobile y en desktop. */
export const NAV = {
  HOY: "Hoy",
  AGENDA: "Agenda",
  PACIENTES: "Pacientes",
  COBROS: "Cobros",
} as const;

/** Configuración, dicha como la diría ella. */
export const TU_CONSULTORIO = "Tu consultorio";

/** Deudores / Cobranza. */
export const TE_DEBEN = "Te deben";

// ────────────────────────────────────────────────────────────────────────────
// Pestañas de la ficha del paciente
// ────────────────────────────────────────────────────────────────────────────

export const SESIONES = "Sesiones";
export const RECORRIDO = "Recorrido";
export const FICHA = "Ficha";

// ────────────────────────────────────────────────────────────────────────────
// Estado de la nota clínica
// ────────────────────────────────────────────────────────────────────────────

/** Nota generada, todavía sin aprobar. Reemplaza a "Lista para revisar",
 *  "Pendiente de aprobación" y "Nota lista para revisar". */
export const PARA_REVISAR = "Para revisar";

/** Nota aprobada. Reemplaza a "Sesión documentada ✓". */
export const NOTA_GUARDADA = "Nota guardada";

/** La sesión está en el pipeline. Reemplaza a "Procesando con IA…". */
export const ESCRIBIENDO_NOTA = "Escribiendo la nota…";

/** Acción para abrir la nota que espera aprobación. */
export const REVISAR_NOTA = "Revisar nota";

/** Bloque plegado con el resto de lo que devolvió el análisis (temas,
 *  emociones, intervenciones, compromisos). Reemplaza a "Datos extraídos". */
export const MAS_DE_ESTA_SESION = "Más de esta sesión";

/** Bloque plegado con la auto-supervisión. Reemplaza a "Auto-supervisión
 *  de la sesión": el feedback es para ella, no sobre la paciente. */
export const PARA_VOS = "Para vos";

// ────────────────────────────────────────────────────────────────────────────
// Nota clínica SOAP — el formato NO cambia, solo se explica.
// Cada sección conserva su nombre y su letra; `ayuda` es la línea de apoyo
// que va debajo del rótulo.
// ────────────────────────────────────────────────────────────────────────────

export const SOAP_S = {
  titulo: "Subjetivo (S)",
  ayuda: "Lo que la paciente relató",
} as const;

export const SOAP_O = {
  titulo: "Objetivo (O)",
  ayuda: "Lo que observaste",
} as const;

export const SOAP_A = {
  titulo: "Análisis (A)",
  ayuda: "Tu lectura clínica",
} as const;

export const SOAP_P = {
  titulo: "Plan (P)",
  ayuda: "Para la próxima sesión",
} as const;

/** Las cuatro secciones en orden, para renderizar la nota completa. */
export const SOAP_SECCIONES = [SOAP_S, SOAP_O, SOAP_A, SOAP_P] as const;

/** Título de la nota. Sigue siendo una nota SOAP y se dice. */
export const NOTA_CLINICA = "Nota clínica (SOAP)";

// ────────────────────────────────────────────────────────────────────────────
// Instrumentos de auto-supervisión — la sigla NO se reemplaza.
// Son instrumentos validados y publicados: cambiarles el nombre le quitaría
// a la profesional la posibilidad de rastrear qué se le está midiendo.
// ────────────────────────────────────────────────────────────────────────────

export const GTFS = {
  sigla: "GTFS",
  nombre: "Gestalt Therapy Fidelity Scale",
  ayuda: "Tu práctica gestáltica en esta sesión",
} as const;

export const MITI = {
  sigla: "MITI 4.2.1",
  nombre: "Motivational Interviewing Treatment Integrity",
  ayuda: "Cómo acompañaste en esta sesión",
} as const;

export const CTSR = {
  sigla: "CTS-R",
  nombre: "Cognitive Therapy Scale — Revised",
  ayuda: "Cómo estructuraste esta sesión",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Riesgo clínico
// La señal se nombra igual en la nota, en el brief y en el recorrido.
// La casilla obligatoria de revisión antes de aprobar no se toca.
// ────────────────────────────────────────────────────────────────────────────

/** Reemplaza a "Señales a observar", "Flags de riesgo" y "Flags de riesgo
 *  clínico": tres nombres para lo mismo. */
export const SENAL_DE_RIESGO = "Señal de riesgo";

/** Cita literal de la transcripción que sostiene la señal. Reemplaza a
 *  "Segmento citado" y a "Ver N citas de la transcripción". */
export const LO_QUE_DIJO = "Lo que dijo";

/** Casilla obligatoria antes de aprobar con nivel alto o moderado.
 *  Requisito del contrato de riesgo clínico: no se quita ni se preselecciona. */
export const REVISE_ESTA_SENAL = "Revisé esta señal";

/** Señales de riesgo de sesiones anteriores. Reemplaza a "Riesgos históricos". */
export const SENALES_ANTERIORES = "Señales anteriores";

// ────────────────────────────────────────────────────────────────────────────
// Material de la sesión
// ────────────────────────────────────────────────────────────────────────────

/** Reemplaza a "Material nuevo". */
export const APARECIO_POR_PRIMERA_VEZ = "Apareció por primera vez";

/** Reemplaza a "Material recurrente". */
export const VUELVE_A_APARECER = "Vuelve a aparecer";

/** Reemplaza a "Compromisos". */
export const SE_LLEVO = "Se llevó";

/** Reemplaza a "Foco sugerido para próxima sesión". Es también la ayuda de
 *  la sección Plan (P), que sigue llamándose Plan (P). */
export const PARA_LA_PROXIMA = "Para la próxima";

// ────────────────────────────────────────────────────────────────────────────
// Contexto longitudinal
// ────────────────────────────────────────────────────────────────────────────

/** Reemplaza a "Contexto longitudinal" y a "Golden Thread". */
export const EL_HILO = "El hilo";

/** Reemplaza a "Resumen acumulativo". */
export const EL_RECORRIDO_HASTA_HOY = "El recorrido hasta hoy";

/** Reemplaza a "Evolución clínica". */
export const COMO_VA = "Cómo va";

/** Card de preparación antes de la sesión. Ya se llama así en la app. */
export const PARA_RETOMAR = "Para retomar";

// ────────────────────────────────────────────────────────────────────────────
// Turnos
// ────────────────────────────────────────────────────────────────────────────

/** Único nombre del estado "programado". Reemplaza a "Programado" en la
 *  fila de sesión y a "Agendado" en la ficha, que hoy conviven. */
export const AGENDADO = "Agendado";

/** Reemplaza a "Marcar como ausente" / "Ausente". */
export const NO_VINO = "No vino";

// ────────────────────────────────────────────────────────────────────────────
// Grabación
// ────────────────────────────────────────────────────────────────────────────

export const GRABAR_SESION = "Grabar sesión";
export const TERMINAR_SESION = "Terminar la sesión";
export const PAUSAR = "Pausar";
export const REANUDAR = "Reanudar";

/** Un solo texto para todo el tramo cifrar + subir + confirmar. Reemplaza a
 *  "Cifrando audio…", "Subiendo el audio cifrado…" y "Audio cifrado listo". */
export const GUARDANDO = "Guardando…";

// ────────────────────────────────────────────────────────────────────────────
// Autorización de grabación (consentimiento informado)
// ────────────────────────────────────────────────────────────────────────────

/** Título del documento que firma la paciente. */
export const AUTORIZACION_GRABACION = "Autorización para grabar las sesiones";

/** Estado: la paciente todavía no firmó. Reemplaza a "Sin autorización de
 *  grabación". */
export const FALTA_AUTORIZACION = "Falta la autorización";

/** Acción que abre el documento para firmar. */
export const FIRMAR_AUTORIZACION = "Firmar autorización";

// ────────────────────────────────────────────────────────────────────────────
// Errores — en castellano, sin HTTP, sin R2, sin CORS.
// Cada uno dice qué pasó, si se perdió algo y qué puede hacer ella.
// ────────────────────────────────────────────────────────────────────────────

/** Falló la subida del audio. Lo importante es que no se perdió. */
export const AUDIO_NO_GUARDADO =
  "No se pudo guardar el audio. Está a salvo en tu teléfono. Probá de nuevo.";

/** Falló el pipeline de transcripción o redacción. */
export const NOTA_NO_ESCRITA = "No pudimos escribir la nota";

/** Cualquier otro fallo. Reemplaza a "HTTP 500", "Error interno" y
 *  "Algo salió mal". */
export const ALGO_FALLO = "Algo falló. Probá de nuevo.";

// ────────────────────────────────────────────────────────────────────────────
// Plural
// ────────────────────────────────────────────────────────────────────────────

/**
 * "1 sesión" / "2 sesiones". Devuelve el número y la palabra ya unidos,
 * que es como se usa siempre en pantalla.
 *
 * El cero va en plural, como en castellano rioplatense: "0 sesiones".
 */
export function pluralizar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
