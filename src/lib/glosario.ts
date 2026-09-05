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

/** Chip de la cabecera de la nota mientras no está aprobada. Es el mismo
 *  concepto que PARA_REVISAR: no se agrega un cuarto nombre para el estado
 *  que ya tenía tres en el código viejo. */
export const BORRADOR = PARA_REVISAR;

/** Chip de la cabecera de la nota una vez aprobada (= NOTA_GUARDADA). */
export const APROBADA = NOTA_GUARDADA;

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
// Recordatorio de la sesión (el SMS)
// Se llama igual que en "Tu consultorio": Recordatorio. No "aviso", no
// "notificación", no "SMS" — la profesional configura un recordatorio y en el
// turno ve ese mismo recordatorio.
// ────────────────────────────────────────────────────────────────────────────

export const RECORDATORIO = "Recordatorio";

/** Cómo se dice cada estado del recordatorio en la pantalla del turno.
 *  "enviando" es la reserva interna del cron: para ella es "saliendo". */
export const RECORDATORIO_ESTADO: Readonly<Record<string, string>> = {
  pendiente: "Todavía no salió",
  enviando: "Saliendo",
  enviado: "Enviado",
  fallido: "No se pudo enviar",
  cancelado: "Cancelado",
};

/** Acción de volver a poner en cola un recordatorio que falló. */
export const REINTENTAR_RECORDATORIO = "Volver a intentarlo";
export const REINTENTANDO_RECORDATORIO = "Poniéndolo en cola…";

export const REINTENTAR_RECORDATORIO_TITULO = "¿Volver a mandar el recordatorio?";
export const REINTENTAR_RECORDATORIO_MENSAJE =
  "Se pone otra vez en la cola y sale en la próxima pasada, en unos minutos. Si vuelve a fallar, lo vas a ver acá.";

// ────────────────────────────────────────────────────────────────────────────
// Grabación
// ────────────────────────────────────────────────────────────────────────────

export const GRABAR_SESION = "Grabar sesión";

/** Estado de la grabación detenida a propósito, no por un corte. */
export const EN_PAUSA = "En pausa";
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
// Pantalla de Hoy
// Los rótulos que estaban sueltos en dashboard.tsx y card-ahora.tsx. Son las
// mismas palabras que usan la agenda y Cobros: se dicen una sola vez.
// ────────────────────────────────────────────────────────────────────────────

export const AGENDA_DEL_DIA = "Agenda del día";

/** KPI: cuántas sesiones tiene el día. */
export const SESIONES_HOY = "Sesiones hoy";

/** KPI: deuda acumulada. Es el mismo concepto que TE_DEBEN, dicho como
 *  número: el bloque se llama "Te deben" y el KPI "Por cobrar". */
export const POR_COBRAR = "Por cobrar";

/** KPI: lo cobrado en el mes corriente. */
export const ESTE_MES = "Este mes";

/** Acción de registrar el pago de una sesión. */
export const COBRAR = "Cobrar";

/** Enlace a la ficha de la paciente desde cualquier tarjeta. */
export const VER_FICHA = "Ver ficha";

/** La hora del turno ya empezó y todavía no terminó. */
export const EN_CURSO = "En curso";

/** El turno es el próximo del día y todavía no empezó. */
export const ENSEGUIDA = "Enseguida";

/** Título del sheet que pregunta cómo pagó. */
export const METODO_DE_PAGO = "Método de pago";

// Estados de pago y de turno, tal como se muestran en chips y listas.
export const PAGADO = "Pagado";
export const PENDIENTE = "Pendiente";
export const CANCELADO = "Cancelado";

// ────────────────────────────────────────────────────────────────────────────
// Pantalla de la nota (sesiones/[id])
// Vivían en sesiones/[id]/_components/textos.ts porque ese agente no podía
// editar este archivo. Ese módulo ahora los re-exporta desde acá.
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Pantalla del Recorrido (pacientes/[id] · gráficos)
// Vivían en pacientes/[id]/_components/graficos/textos.ts porque ese agente
// no podía editar este archivo. Ese módulo ahora los re-exporta desde acá.
// ────────────────────────────────────────────────────────────────────────────

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

/** Estados vacíos del Recorrido. */
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
