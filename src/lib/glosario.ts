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

// El único import del módulo, y es de tipos: `MetodoPago` no existe en
// tiempo de ejecución, así que el glosario sigue siendo sólo strings.
import type { MetodoPago } from "@/types/domain";

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
// Menú y cabecera
// ────────────────────────────────────────────────────────────────────────────

export const VER_NOTA = "Ver nota";
export const NOTA_PROCESANDO = "Procesando";

export const INICIO_CARGAR_TARIFA = "Cargá tu tarifa";
export const INICIO_CARGAR_PACIENTE = "Cargá tu primera paciente";
export const INICIO_AGENDAR_SESION = "Agendá la primera sesión";

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

/**
 * La ayuda de la S no dice el género de nadie. Decía "Lo que la paciente
 * relató", y el modelo de datos NO tiene género: `Paciente` es nombre,
 * apellido, teléfono, email, tarifa (prisma/schema.prisma). O sea que ese
 * femenino no salía del dato, estaba escrito fijo — y la app lo mostraba
 * igual sobre un paciente varón.
 *
 * No se inventa un campo para arreglarlo: se dice de una forma que sirve
 * para cualquier paciente y no pierde nada clínico. Si algún día el modelo
 * trae género, esta línea puede volver a declinarse desde el dato.
 */
export const SOAP_S = {
  titulo: "Subjetivo (S)",
  ayuda: "Lo relatado en sesión",
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

/** El horario ya está ocupado por otro turno que no está cancelado ni
 *  marcado "No vino". Lo devuelve la API (409) y el formulario lo muestra
 *  tal cual, así que dice qué hacer y no sólo qué pasó. */
export const TURNO_SOLAPADO =
  "Ya tenés un turno a esa hora. Elegí otro horario, o cancelá el que está.";

/** Revierte el cobro de un turno: vuelve a quedar sin cobrar. No es
 *  "Anular" ni "Eliminar pago": no se borra nada, se deshace lo último. */
export const DESHACER_COBRO = "Deshacer cobro";

/** Confirmación: dice exactamente qué queda después. Se puede volver a
 *  cobrar, así que no lleva tono de peligro. */
export const DESHACER_COBRO_TITULO = "¿Deshacer el cobro?";
export const DESHACER_COBRO_MENSAJE =
  "El turno vuelve a quedar sin cobrar, con su monto en la deuda. Lo podés volver a cobrar cuando quieras.";
export const DESHACER_COBRO_ACCION = "Deshacer el cobro";
export const DESHACIENDO_COBRO = "Deshaciendo…";

/** Confirmación de que quedó deshecho. */
export const COBRO_DESHECHO = "Cobro deshecho";

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

// ─── Avisos de una grabación en curso ───────────────────────────────────────
// Los tres son persistentes: se quedan en pantalla mientras la condición
// dure. No son toasts. Un aviso que se va solo no sirve para algo que hay
// que resolver ahora.

/** Falta poco para el tope de 150 minutos. El número sale de
 *  AVISO_LIMITE_SEGUNDOS: se avisa con 15 minutos de anticipación. */
export const AVISO_LIMITE_GRABACION = "Quedan 15 minutos de grabación";

/** El sistema operativo soltó el wake lock: la pantalla se apagó sola o ella
 *  la apagó. Es la antesala del corte del 7/9, y por eso se dice con todas
 *  las letras qué puede pasar y qué hacer. */
export const AVISO_PANTALLA_APAGADA =
  "La pantalla se apagó: la grabación se puede cortar. Mantenela encendida.";

/** Hace rato que no entra señal y la pantalla está a la vista. Se avisa
 *  antes de cortar porque en sesión un silencio largo puede ser normal. */
export const AVISO_SIN_SONIDO = "No está entrando sonido";

// ─── Por qué se interrumpió una grabación ───────────────────────────────────
// Una interrupción NUNCA cierra la sesión sola: el audio queda entero y ella
// decide si reanuda o termina. Lo que cambia es la explicación, porque no se
// resuelven igual.

/** El micrófono se cortó: llamada entrante, otra app se lo llevó, la pista
 *  murió. Se reanuda volviendo a pedir el micrófono. */
export const CORTE_MICROFONO = "Se cortó el micrófono. Lo grabado está a salvo.";

/** Se llegó al tope de duración. No es una falla: es el archivo que no puede
 *  crecer más. Se dice el número para que se entienda que no se rompió nada. */
export const CORTE_LIMITE =
  "Llegaste a las 2 horas y media de grabación. Lo grabado está a salvo.";

/** No entró sonido durante minutos. La causa más común es la pantalla
 *  bloqueada, así que se nombra: es lo que ella puede cambiar. */
export const CORTE_SIN_SONIDO =
  "Dejó de entrar sonido y se pausó la grabación. Lo grabado está a salvo.";

/** La pantalla se apagó y el navegador descargó la página. Se vuelve con los
 *  chunks recuperados del teléfono, en pausa, esperando decisión. */
export const CORTE_PANTALLA =
  "La pantalla se apagó y se pausó la grabación. Lo grabado está a salvo.";

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

// ────────────────────────────────────────────────────────────────────────────
// Estado del turno en chips y listas
// Un solo par de palabras para el mismo estado: la fila de la agenda decía
// "Pagado"/"Pendiente" y el sheet del turno "Cobrado"/"Sin cobrar". Es el
// mismo turno mirado desde dos pantallas, así que se llama igual en las dos.
// ────────────────────────────────────────────────────────────────────────────

export const PAGADO = "Pagado";
export const PENDIENTE = "Pendiente";
export const CANCELADO = "Cancelado";

// ────────────────────────────────────────────────────────────────────────────
// Métodos de pago
// La lista estaba escrita cuatro veces —el sheet de la agenda, el sheet de
// Hoy, la pestaña de pagos de la ficha y la lista de cobros—, dos veces como
// array y dos como Record. Acá vive una sola vez.
// ────────────────────────────────────────────────────────────────────────────

/** Cómo se dice cada método guardado. El orden es el de la lista. */
export const METODO_PAGO_LABEL: Readonly<Record<MetodoPago, string>> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "MercadoPago",
  debito: "Débito",
  credito: "Crédito",
  otro: "Otro",
};

/** Los métodos en el orden en que se ofrecen, para renderizar la lista. */
export const METODOS_PAGO: ReadonlyArray<{
  value: MetodoPago;
  label: string;
}> = (Object.keys(METODO_PAGO_LABEL) as MetodoPago[]).map((value) => ({
  value,
  label: METODO_PAGO_LABEL[value],
}));

/** Un cobro viejo que se registró sin método. */
export const SIN_METODO = "Sin método";

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
// Recordatorio de cobro
//
// El aviso lo manda ella, apretando, una persona por vez. Por eso los textos
// dicen "Enviar SMS" y no "Notificar": se nombra el acto concreto, con el
// canal a la vista, para que sepa exactamente qué va a pasar cuando toque.
// ────────────────────────────────────────────────────────────────────────────

/** El botón de la fila del deudor. */
export const RECORDAR_COBRO = "Recordar cobro";

/** La pregunta de la confirmación, con el mensaje y el número a la vista. */
export const RECORDAR_COBRO_TITULO = "¿Mandarle este mensaje?";

/** El botón que confirma. Dice el canal: sale un SMS, no una notificación. */
export const ENVIAR_SMS = "Enviar SMS";

export const ENVIANDO_SMS = "Enviando…";

/** Toast de éxito. */
export const SMS_ENVIADO = "Aviso enviado";

/** Rótulo del número destino en la confirmación. */
export const SMS_DESTINO = "Sale a";

/** Lo que muestra la fila cuando ya se le avisó. Se completa con
 *  textoAtraso(): "Avisado hace 3 días". */
export const AVISADO = "Avisado";

/** El aviso no salió. Es el ÚNICO texto que la pantalla muestra cuando falla
 *  el envío, pase lo que pase del otro lado: el motivo real de Twilio puede
 *  ser "falta TWILIO_SMS_FROM" o un código de la API, y eso no es algo que
 *  ella pueda leer ni arreglar. Dice las tres cosas que sí le importan: no
 *  salió, no se perdió, se puede volver a intentar. El motivo entero queda en
 *  la auditoría y en el log, que es donde sirve. */
export const SMS_NO_ENVIADO =
  "No pudimos enviar el SMS. Quedó registrado; probá más tarde.";

/** Sin Twilio configurado no hay botón: se dice qué falta y dónde se
 *  arregla, sin nombrar variables de entorno. */
export const SMS_SIN_CONFIGURAR =
  "Para avisar por SMS falta configurar el envío en Tu consultorio.";

// ────────────────────────────────────────────────────────────────────────────
// Vocabulario clínico (hot words)
//
// Nunca se le dice "hot words" ni "word boost" en pantalla: eso es el nombre
// del parámetro de AssemblyAI, no el de la cosa. Lo que ella carga son las
// palabras que la transcripción tiene que escuchar bien.
// ────────────────────────────────────────────────────────────────────────────

/** La sección de "Tu consultorio" y el bloque de la ficha. */
export const VOCABULARIO = "Vocabulario";

/** Qué hace, en una línea, sin hablar de modelos ni de parámetros. */
export const VOCABULARIO_AYUDA =
  "Palabras que la transcripción tiene que escuchar bien: términos clínicos, modismos y nombres propios.";

/** El vocabulario de toda la cuenta: se aplica a todas las sesiones. */
export const VOCABULARIO_GLOBAL = "De todas tus sesiones";

export const VOCABULARIO_GLOBAL_AYUDA =
  "Se usa en cada sesión que grabes, de cualquier paciente.";

/** El de ella: cómo nombra su oficio. */
export const VOCABULARIO_PROFESIONAL = "Tuyo";

export const VOCABULARIO_PROFESIONAL_AYUDA =
  "Las palabras de tu enfoque y tu manera de escribir.";

/** El bloque de la ficha: solo para esa persona. */
export const VOCABULARIO_PACIENTE = "Vocabulario de esta persona";

export const VOCABULARIO_PACIENTE_AYUDA =
  "Nombres y palabras que aparecen solo en las sesiones de este paciente. Se suman a las de toda la cuenta.";

// ────────────────────────────────────────────────────────────────────────────
// Ayuda — Lupita
//
// El personaje de la app (docs/diseno/04-personaje.md, concepto A: el
// brote). Habla en rioplatense, de vos, en frases cortas, sin signos de
// admiración salvo que la frase sea genuinamente una celebración chica.
// Nunca dice "usuario", "sistema" ni "procesando": de ahí que la espera se
// diga "está buscando en la ayuda" y no "procesando tu consulta".
//
// Dónde aparece y dónde no está escrito en el documento: la ayuda, los
// estados vacíos, el onboarding y las confirmaciones alegres. Nunca en la
// nota clínica, en el brief pre-sesión, en el Recorrido, ni a menos de una
// pantalla de una señal de riesgo.
// ────────────────────────────────────────────────────────────────────────────

/** Su nombre. Una sola fuente: también lo lee el system prompt del
 *  asistente (ayuda-corpus.ts), para que no se llame de dos maneras según
 *  quién hable. */
export const LUPITA = "Lupita";

/** La entrada del menú, en mobile y en desktop. */
export const AYUDA = "Ayuda";

/** Rótulo accesible del panel, para el lector de pantalla que anuncia el
 *  diálogo: "Ayuda" solo no dice ayuda de qué. */
export const AYUDA_PANEL = "Ayuda de la app";

/** La línea de bienvenida del encabezado. Dice qué puede preguntar y, en la
 *  misma respiración, lo que Lupita no ve: es la promesa de privacidad de la
 *  app, y se hace antes de que ella escriba nada. */
export const AYUDA_BIENVENIDA =
  "Soy la que sabe dónde quedó cada cosa. Vos preguntá, que yo busco.";

export const AYUDA_PRIVACIDAD =
  "No veo pacientes ni montos. Solo conozco la ayuda de Sesión.";

export const AYUDA_PREGUNTAS_INICIALES = [
  "¿Cómo cambio la tarifa?",
  "¿Cómo configuro el recordatorio?",
  "¿Qué pasa si se corta la grabación?",
] as const;

export const AYUDA_STREAM_CORTADO = "Se cortó, ¿lo repito?";

/** Aviso de que el hilo no se guarda. Va abajo del campo, chico: es ayuda,
 *  no un chat, y el historial vive en memoria hasta que se cierra el panel. */
export const AYUDA_NO_SE_GUARDA =
  "Cuando cerrás, esta conversación no queda.";

/** Placeholder del campo. */
export const AYUDA_PLACEHOLDER = "¿Qué querés saber?";

/** El botón que manda la pregunta. */
export const AYUDA_ENVIAR = "Preguntar";

/** El botón que cierra el panel. */
export const AYUDA_CERRAR = "Cerrar";

/** La espera, mientras el asistente contesta. Nunca "procesando". */
export const AYUDA_ESPERANDO = "Lupita está buscando en la ayuda…";

/** Rótulo accesible del hilo de mensajes. */
export const AYUDA_HILO = "Conversación con Lupita";

/** Quién dijo cada mensaje, para el lector de pantalla: en la pantalla se
 *  distinguen por el lado y por el brote, que no se leen en voz alta. */
export const AYUDA_DIJO_USUARIA = "Vos:";
export const AYUDA_DIJO_LUPITA = "Lupita:";

// Los tres errores del panel. Ninguno dice el status, el proveedor ni el
// motivo técnico: eso queda en el log de la función.

/** No hubo forma de llegar al servidor. */
export const AYUDA_SIN_CONEXION =
  "Te quedaste sin conexión. Probá de nuevo cuando vuelva.";

/** Se acabaron las preguntas del día. */
export const AYUDA_TOPE_DIARIO =
  "Por hoy Lupita ya contestó todo lo que podía. Mañana sigue.";

// El fallo del proveedor usa ALGO_FALLO, más abajo: no se le inventa un
// texto propio a algo que para ella es exactamente lo mismo que cualquier
// otro fallo.

// ────────────────────────────────────────────────────────────────────────────
// Ficha, Pacientes y Agenda
//
// Los textos de las tres pantallas que se navegan una detrás de la otra:
// la lista de pacientes, la ficha de una persona y el día de la agenda.
//
// Los dos estados vacíos de acá son de los que hablan con la voz de Lupita
// (docs/diseno/04-personaje.md): enseñan el próximo paso en vez de decir
// "no hay datos". La ficha, el brief y el Recorrido NO: son pantallas
// clínicas y ahí el personaje no entra.
// ────────────────────────────────────────────────────────────────────────────

/** El botón que crea una persona. Se dice igual en la lista, en el estado
 *  vacío y en el rótulo del flotante. */
export const NUEVO_PACIENTE = "Nuevo paciente";

/** Lista de pacientes sin nadie todavía. Es la voz de Lupita, textual del
 *  documento del personaje. */
export const PACIENTES_VACIO_TITULO = "Todavía no hay nadie acá.";
export const PACIENTES_VACIO_LINEA =
  "Cuando cargues tu primer paciente, aparece en esta lista.";

/** El monto que debe una persona, en la lista. El chip iba sin rótulo y en
 *  la misma fila hay otro número con signo de pesos —la tarifa—: sin la
 *  palabra, "$ 11.000" al lado de "$ 2.200" pide un segundo de lectura. */
export const DEBE = "Debe";

/** El Editar de la cabecera de la ficha. Dice qué edita porque el Recorrido
 *  tiene su propio Editar, para el hilo, a una pantalla de distancia. */
export const EDITAR_DATOS = "Editar datos";

/** La acción principal de la ficha: grabar la sesión de esta persona. */
export const GRABAR = "Grabar";

/** El día de la agenda sin turnos. La primera línea es la de Lupita; las
 *  otras dos enseñan lo que la pantalla hace sola. */
export const AGENDA_DIA_VACIO_TITULO = "Nada agendado este día";
export const AGENDA_DIA_VACIO_LINEAS: [string, string, string] = [
  "A veces eso también es parte del trabajo.",
  "Si el paciente ya vino, la app propone el mismo día y hora de la última vez.",
  "El recordatorio se programa solo al agendar.",
];

/** El botón que agenda un turno, desde el estado vacío o desde el header. */
export const AGENDAR = "Agendar";

/** Los puntos del mes: dorado y verde no se explican en ningún lado de esa
 *  pantalla, y son el único dato de la grilla. */
export const MES_LEYENDA = "Cada punto es un turno:";

/** La carga masiva del vocabulario, que vive plegada: se usa una vez, al
 *  principio, y el resto del tiempo estorba a la lista. */
export const VOCABULARIO_CARGA_MASIVA = "Carga masiva";
export const VOCABULARIO_CARGA_MASIVA_AYUDA =
  "Pegá una lista de términos separados por coma o salto de línea.";

/** Quitar un término de la nube. Dos toques: el primero pregunta. */
export const VOCABULARIO_QUITAR = "Quitar";
export const VOCABULARIO_QUITAR_CONFIRMAR = "¿Quitar?";

// ────────────────────────────────────────────────────────────────────────────
// Cobros y sistema
// Lo que dice la pantalla de Cobros, que hasta ahora vivía suelto adentro de
// cobros-view.tsx. Los estados vacíos siguen la forma de siempre —titular y
// tres líneas que enseñan el próximo paso— y los rótulos de la grilla dicen
// cada hecho una sola vez.
// ────────────────────────────────────────────────────────────────────────────

/** Rótulo del número que entró este mes. */
export const COBRASTE_ESTE_MES = "Cobraste este mes";

/**
 * Rótulo de lo que falta cobrar, en la grilla de Cobros.
 *
 * Dice "Sin cobrar" y no TE_DEBEN a propósito: "Te deben" es el nombre de
 * una vista —la pestaña con la lista de deudoras— y usarlo también para un
 * número dejaba el mismo rótulo nombrando dos cosas distintas en la misma
 * pantalla (01-auditoria-frontend.md, 5).
 */
export const SIN_COBRAR = "Sin cobrar";

/** La otra vista de Cobros: los pagos que entraron este mes. */
export const COBROS_DEL_MES = "Cobros del mes";

/** Rótulo accesible del control que cambia entre las dos vistas. */
export const VISTA_DE_COBROS = "Vista de cobros";

/** El titular del bloque de deuda: la deuda se cuenta en sesiones, que es
 *  como ella la piensa. Se completa con el número. */
export const SIN_COBRAR_FRASE_FINAL = "sin cobrar.";

// ─── Estado vacío: nadie debe nada ──────────────────────────────────────────
// Es la única confirmación alegre que 04-personaje.md le permite a Cobros, y
// por eso es el único lugar de esta pantalla donde aparece Lupita.

export const NADIE_TE_DEBE = "Nadie te debe";
export const NADIE_TE_DEBE_LINEAS = [
  "Todas las sesiones realizadas están cobradas.",
  "Cuando cobres un turno desde la agenda, el pago aparece en Cobros del mes.",
  "Si alguien queda sin pagar, va a aparecer acá con un botón para recordárselo.",
] as const;

/** El botón del estado vacío: lleva a la otra vista. */
export const VER_COBROS_DEL_MES = "Ver cobros del mes";

// ─── Estado vacío: todavía no entró nada este mes ───────────────────────────
// Este no se celebra: no cobrar nada en un mes no es una buena noticia. Va
// con el ícono de siempre y sin personaje.

export const SIN_COBROS_ESTE_MES = "Todavía no cobraste este mes";
export const SIN_COBROS_ESTE_MES_LINEAS = [
  "Los cobros se registran desde el turno, en la agenda o en Hoy.",
  "Cada pago aparece acá con la fecha y el método.",
  "Lo que quedó sin cobrar está en Te deben.",
] as const;

/** El botón del estado vacío: lleva a la otra vista. */
export const VER_TE_DEBEN = "Ver te deben";

// ─── Estado vacío: no se pudieron traer los cobros ──────────────────────────

export const COBROS_NO_CARGARON = [
  "No pudimos traer los cobros.",
  "Puede ser la conexión.",
  "Tus datos no se perdieron.",
] as const;

/** El botón de cualquier fallo de carga sale de REINTENTAR, más arriba: es
 *  el mismo verbo que ya usa la nota. */

/** Mientras la pantalla trae los datos. Nunca "cargando datos" ni
 *  "procesando". */
export const CARGANDO = "Cargando…";

// La confirmación del cobro (COBRADO) y su fallo (NO_SE_PUDO_COBRAR) viven
// en la sección de Hoy, que es la pantalla desde donde se cobra.

// ────────────────────────────────────────────────────────────────────────────
// Errores — en castellano, sin HTTP, sin R2, sin CORS.
// Cada uno dice qué pasó, si se perdió algo y qué puede hacer ella.
// ────────────────────────────────────────────────────────────────────────────

/** Falló la subida del audio. Lo importante es que no se perdió. */
export const AUDIO_NO_GUARDADO =
  "No se pudo guardar el audio. Está a salvo en tu teléfono. Probá de nuevo.";

/** El audio se guardó pero el turno no llegó a quedar como realizado. Se
 *  dice en ese orden: primero lo que sí se salvó (la sesión, que es lo
 *  irrecuperable), después lo que falta y se puede repetir. */
export const TURNO_NO_MARCADO =
  "La sesión se guardó, pero el turno quedó como agendado. Probá de nuevo.";

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

// ────────────────────────────────────────────────────────────────────────────
// Hoy
// Los textos propios de la pantalla de Hoy: el estado vacío del día, lo que
// se dice cuando ya no queda ninguna sesión por delante y las cuatro
// confirmaciones que antes vivían sueltas en dashboard.tsx.
// ────────────────────────────────────────────────────────────────────────────

/** Estado vacío del día, con Lupita al lado (docs/diseno/04-personaje.md).
 *  Dos frases: la primera dice el hecho, la segunda lo acompaña. */
export const HOY_SIN_TURNOS_TITULO = "Hoy no hay nada agendado.";
export const HOY_SIN_TURNOS_DETALLE =
  "A veces eso también es parte del trabajo.";

/** Pie del encabezado cuando el día no tiene ningún turno. */
export const HOY_SIN_SESIONES = "sin sesiones agendadas";

/** El día tiene turnos, pero todos ya pasaron: no hay ninguna sesión que
 *  esperar. Ocupa el lugar de la tarjeta de AHORA. */
export const HOY_SIN_PROXIMA = "No queda ninguna sesión por delante hoy.";

/** Confirmaciones y fallos de la pantalla de Hoy. Estaban escritos a mano en
 *  dashboard.tsx, que es exactamente lo que este módulo existe para evitar. */

/**
 * El toast de vuelta después de cobrar, con las palabras que le pone
 * docs/diseno/04-personaje.md. La frase es alegre; el dibujo que la
 * acompaña es el CheckDibujado de siempre (`variante="confirmacion"`).
 *
 * Lupita no entra al toast: se dibuja sobre ink-900 y su paleta está fijada
 * sobre blanco o crema (ver la nota de ui/toast.tsx). El tono alegre lo
 * ponen las palabras, que es donde 04-personaje.md dice que vive.
 */
export const COBRADO = "Cobrado. Ese ya está.";

/** El cobro no entró. Va sin check —`variante="aviso"`—: un tilde verde
 *  sobre un fracaso es la peor confirmación posible. */
export const NO_SE_PUDO_COBRAR = "No se pudo cobrar. Probá de nuevo.";
export const TURNO_AGENDADO = "Turno agendado";
export const NO_SE_PUDO_AGENDAR = "No se pudo agendar. Probá de nuevo.";

// ────────────────────────────────────────────────────────────────────────────
// "Para vos" — la auto-supervisión, ahora como vista hermana de la nota
//
// Dejó de ser un plegable al pie de la nota (seis pantallas de scroll abajo,
// cerrado) y pasó a tener URL propia: /sesiones/[id]/para-vos. Se llega por
// el selector de arriba de la nota, por el aviso de después de aprobar y por
// la fila de la sesión en la ficha.
//
// Es material sobre su práctica, no un premio: acá no hay personaje, no hay
// celebración y no hay entrada animada (docs/diseno/04-personaje.md). Con
// señal de riesgo en la sesión, la vista es exactamente la misma.
// ────────────────────────────────────────────────────────────────────────────

/** Rótulo de la nota en el selector de dos opciones. Es NOTA_CLINICA sin el
 *  "(SOAP)": el paréntesis no entra en un control de dos botones a 390 px, y
 *  el formato ya está dicho en el título de la nota, dos líneas más abajo. */
export const VISTA_NOTA = "Nota clínica";

/** aria-label del selector: dice qué elige, no cómo se llama el control. */
export const SELECTOR_VISTA_SESION = "Qué mirás de esta sesión";

/** Línea bajo el título de la vista. Dice de quién habla lo que sigue, que
 *  es la única confusión posible con una pantalla que cuelga de una nota. */
export const PARA_VOS_SUBTITULO = "Sobre tu trabajo en esta sesión.";

/**
 * El análisis llegó a medias. Antes, cuando al payload le faltaba una parte,
 * el guardián de la nota lo escondía ENTERO y en silencio: ella no se
 * enteraba de que había feedback. Ahora se muestra lo que llegó y este aviso
 * dice que hay un hueco. Chico y sin alarma: no es un error de ella.
 */
export const PARA_VOS_INCOMPLETO = "Parte del análisis no llegó.";

/** No hay ningún análisis para esta sesión. Se dice, en vez de dejar una
 *  pantalla vacía: puede ser una sesión vieja o una que falló. */
export const PARA_VOS_SIN_ANALISIS = "Esta sesión no tiene análisis.";

/** Enlace a la vista, desde el aviso de después de aprobar y desde la fila
 *  de la sesión en la ficha. */
export const LEER_PARA_VOS = "Leer Para vos";

/**
 * Aviso que queda en la nota después de aprobar. Antes la pantalla se iba
 * sola a los 1,1 s — justo cuando ella había terminado y era el momento de
 * leer "Para vos". Ahora se queda, y el aviso ofrece el camino.
 *
 * Es una confirmación, no una celebración: la nota clínica no lleva
 * personaje (docs/diseno/04-personaje.md).
 */
export const NOTA_APROBADA_AVISO = "Nota aprobada. Queda guardada así.";

/**
 * Salir de la nota en revisión con correcciones sin aprobar.
 *
 * El texto que ella edita vive en el estado de la pantalla y sólo se escribe
 * al aprobar (sesion-detail-view.tsx). Cualquier cosa que desmonte esa
 * pantalla —el selector de vista, el botón "Volver"— se lleva las
 * correcciones sin que nada lo diga. Este es el aviso que lo tapa, y es el
 * mismo en las dos puertas.
 *
 * El mensaje no nombra el destino a propósito: sirve igual yendo a "Para
 * vos" que yendo para atrás, y una sola frase se aprende una vez.
 *
 * Las dos salidas se nombran por lo que hacen: ni "Sí/No" ni
 * "Aceptar/Cancelar".
 */
export const CAMBIOS_SIN_APROBAR_TITULO =
  "Tenés cambios sin aprobar en la nota.";
export const CAMBIOS_SIN_APROBAR_MENSAJE =
  "Si salís de la nota ahora, se pierden.";
export const QUEDARME = "Quedarme";
export const IR_IGUAL = "Ir igual";

// ────────────────────────────────────────────────────────────────────────────
// Carga y navegación
//
// Lo que se dice mientras una pantalla todavía no es la pantalla.
//
// En pantalla no se dice nada: lo que se ve es el esqueleto
// (src/components/esqueletos/), que dibuja los bloques que van a llegar en
// gris crema. Estos textos son para el lector de pantalla —el `sr-only` de
// cada esqueleto— y por eso nombran la pantalla concreta: quien no ve el
// dibujo necesita saber QUÉ está por llegar, no que "algo" está cargando.
//
// CARGANDO ("Cargando…", en la sección de Cobros) sigue existiendo para los
// bloques sueltos que todavía no tienen esqueleto propio.
// ────────────────────────────────────────────────────────────────────────────

/** Fallback de cualquier pantalla del dashboard sin esqueleto propio. */
export const CARGANDO_PANTALLA = "Cargando la pantalla…";

/** Hoy. La misma frase que decía el estado de carga viejo, en minúscula,
 *  porque es media pantalla de espera y no un proceso. */
export const CARGANDO_HOY = "Cargando tu día…";

export const CARGANDO_PACIENTES = "Cargando tus pacientes…";

export const CARGANDO_COBROS = "Cargando tus cobros…";

/** La nota ya tenía su frase —ABRIENDO_NOTA— y se usa esa: el esqueleto no
 *  es un estado nuevo, es el mismo momento mejor dibujado. */

// ────────────────────────────────────────────────────────────────────────────
// Entrada
// La pantalla de /login, que hasta hoy era un formulario sin nombre ni
// presencia. Es la única pantalla que ve alguien que todavía no es usuaria,
// así que es la única que tiene que decir qué es esto.
//
// Es institucional: acá NO entra Lupita (docs/diseno/04-personaje.md fija
// dónde aparece —ayuda, estados vacíos, onboarding, confirmaciones alegres—
// y la entrada no es ninguno de esos).
// ────────────────────────────────────────────────────────────────────────────

/**
 * El nombre del producto y su eslogan, en dos constantes y no en dos
 * literales repartidos por el árbol.
 *
 * Por qué así: el dueño está decidiendo si el nombre es "Sesión" y el
 * eslogan "Consultorio inteligente" o exactamente al revés. Con las dos
 * constantes acá, darlo vuelta es cambiar estas dos líneas; con el texto
 * escrito a mano habría que ir a la pantalla de entrada, al manifiesto de la
 * PWA y a cualquier lugar que aparezca después.
 *
 * Los dos lugares que hoy las consumen son `src/app/(auth)/login/page.tsx` y
 * `src/app/manifest.ts`.
 */
export const NOMBRE_PRODUCTO = "Sesión";
export const ESLOGAN = "Convertí tu trabajo en un flujo enriquecedor";

/**
 * Qué hace, en una frase. No es un párrafo a propósito: quien llega acá
 * está por escribir su contraseña, no por leer una landing.
 *
 * Dice el beneficio y no la tecnología —no aparece "IA" ni "transcripción"—
 * porque lo que se promete es el rato que le queda libre, que es lo que ella
 * mide.
 */
export const ENTRADA_QUE_HACE =
  "El trabajo de después de la sesión, hecho antes de que entre la próxima.";

/**
 * Las tres cosas que hace, una línea cada una y en este orden: la nota
 * primero, porque es el motivo por el que alguien instalaría esto; después
 * lo administrativo; al final el análisis, que es lo que ninguna otra
 * promete.
 *
 * La primera nombra a la profesional como quien decide ("la aprobás vos"):
 * es la misma regla que sostiene toda la app —el borrador se llama borrador
 * hasta que ella lo firma, ver [[BORRADOR]] y docs/diseno/02-referencias.md—
 * y en la pantalla de entrada es, además, la respuesta a la primera objeción
 * que tiene cualquier psicóloga frente a una nota escrita por una máquina.
 */
export const ENTRADA_AFIRMACIONES = [
  "La nota clínica se escribe sola y la aprobás vos.",
  "Los cobros y los recordatorios, al día.",
  "Un análisis de tu propia práctica, hecho para vos.",
] as const;

/**
 * La confidencialidad, en una línea y con dos hechos verificables, no con un
 * sello de confianza. Las dos afirmaciones son literalmente lo que hace el
 * código y lo que ya le decimos a la paciente en el consentimiento
 * (`src/lib/consentimiento.ts:55-58`): se cifra en el dispositivo antes de
 * salir (`src/lib/grabacion-cifrado.ts`) y se borra al aprobarse la nota.
 *
 * No decimos "seguro", "encriptación de grado militar" ni ninguna sigla de
 * cumplimiento: son el vocabulario de las apps del norte y acá no
 * significarían nada.
 */
export const ENTRADA_CONFIDENCIALIDAD =
  "El audio se cifra antes de salir de tu teléfono y se borra cuando aprobás la nota.";

/** Los rótulos del formulario. Estaban escritos a mano en la página. */
export const ENTRADA_EMAIL = "Email";
export const ENTRADA_CONTRASENA = "Contraseña";
export const ENTRAR = "Entrar";
export const ENTRANDO = "Entrando…";

/**
 * Un solo mensaje para los tres casos —contraseña equivocada, email que no
 * existe y acceso bloqueado por intentos—. Decir cuál de los tres fue es
 * decirle a quien prueba si ese email está dado de alta. La segunda línea
 * explica el bloqueo sin afirmar que sea lo que pasó ahora.
 */
export const ENTRADA_ERROR = "Email o contraseña incorrectos";
export const ENTRADA_ERROR_DETALLE =
  "Después de varios intentos seguidos el acceso queda bloqueado unos minutos.";

// Entrada — recuperar acceso
export const ENTRADA_OLVIDASTE = "¿Olvidaste tu contraseña?";
export const ENTRADA_RECUPERAR = "Recuperar contraseña";
export const ENTRADA_RECUPERAR_BOTON = "Mandame un enlace";
export const ENTRADA_RECUPERAR_ENVIADO = "Si ese correo existe, te mandamos un enlace";
export const ENTRADA_RESTABLECER = "Cambiar contraseña";
export const ENTRADA_REPETIR = "Repetí la contraseña";
export const ENTRADA_VOLVER = "Volver a entrar";
export const ENTRADA_PASSWORD_CAMBIADA = "Contraseña cambiada";
export const ENTRADA_PASSWORD_NO_COINCIDE = "Las contraseñas no coinciden.";
export const ENTRADA_PASSWORD_DISTINTA = "La contraseña nueva tiene que ser distinta de la actual.";
export const ENTRADA_ENLACE_INVALIDO = "Este enlace venció o ya se usó. Pedí uno nuevo.";
export const ENTRADA_CUENTA_ERROR = "No pudimos completar el pedido. Probá de nuevo.";

// ────────────────────────────────────────────────────────────────────────────
// Correos
// ────────────────────────────────────────────────────────────────────────────
export const CORREO_RECUPERAR_ASUNTO = "Cambiá tu contraseña de Sesión";
export const CORREO_RECUPERAR_TEXTO = "Recibimos un pedido para cambiar tu contraseña. Abrí este enlace para elegir una nueva:";
export const CORREO_RECUPERAR_BOTON = "Elegir una contraseña nueva";
export const CORREO_RECUPERAR_VENCE = "El enlace vence en una hora y se puede usar una sola vez. Si pedís otro, este deja de funcionar.";
export const CORREO_RECUPERAR_IGNORAR = "Si no lo pediste vos, ignorá este correo. Tu contraseña sigue igual.";
export const CORREO_FIRMA = "Sesión · Tu consultorio, en orden.";


// Entrada — invitaciones, alta y términos provisionales
export const ENTRADA_REGISTRO = "Crear mi cuenta";
export const ENTRADA_NOMBRE = "Tu nombre";
export const ENTRADA_ACEPTA_TERMINOS = "Acepto los términos y la política de privacidad";
export const ENTRADA_TERMINOS_REQUERIDOS = "Para crear tu cuenta necesitás aceptar los términos y la política de privacidad.";
export const ENTRADA_INVITACION_INVALIDA = "Este enlace venció o ya se usó.";
export const ENTRADA_PEDIR_INVITACION = "Pedile otro a quien te invitó";
export const ENTRADA_REGISTRO_ERROR = "No pudimos crear la cuenta con esos datos. Revisalos o probá entrar con tu cuenta.";
export const ENTRADA_CUENTA_CREADA_SIN_SESION = "Tu cuenta ya está creada. Entrá con tu email y contraseña. Si el acceso está bloqueado por intentos, esperá antes de volver a probar.";
export const INVITAR_COLEGA = "Invitar a una colega";
export const INVITAR_DESCRIPCION = "Tu colega crea su propio consultorio, separado del tuyo. El enlace vence en 7 días y se usa una sola vez. Compartilo sólo con ella.";
export const INVITAR_GENERAR = "Generar enlace";
export const INVITAR_ENLACE = "Enlace de invitación";
export const INVITAR_COPIAR = "Copiar";
export const INVITAR_COPIADO = "Enlace copiado";
export const INVITAR_WHATSAPP = "Compartir por WhatsApp";
export const INVITAR_MENSAJE = "Te invito a probar Sesión. Con este enlace creás tu propio consultorio. Vence en 7 días:";
export const INVITAR_ERROR_COPIA = "No pude copiarlo. Seleccioná el enlace y copialo desde tu navegador.";
export const TERMINOS_TITULO = "Términos y política de privacidad";
export const TERMINOS_FECHA = "Borrador del 9 de septiembre de 2026";
export const TERMINOS_VERSION = "borrador-2026-09-09";
export const TERMINOS_BORRADOR = "BORRADOR PENDIENTE DE REVISIÓN LEGAL";
export const TERMINOS_SECCIONES = [
  { titulo: "Qué hace Sesión", texto: "Sesión ayuda a organizar el consultorio: agenda, pacientes, cobros y recordatorios. Puede transcribir una grabación y preparar un borrador de nota clínica que la profesional revisa y aprueba. La aplicación no reemplaza su criterio profesional." },
  { titulo: "Qué información guarda", texto: "La app guarda los datos de la cuenta y del consultorio, los datos de pacientes que cargás, turnos, cobros, consentimientos y registros de actividad. Si grabás una sesión, procesa audio, transcripción y notas. El audio se cifra antes de salir del dispositivo y se borra al aprobar la nota; las notas y transcripciones se guardan cifradas en la base." },
  { titulo: "Dónde se procesa y se guarda", texto: "Vercel ejecuta la aplicación; Neon aloja la base de datos; Cloudflare R2 guarda el audio cifrado y las copias de respaldo cifradas. Railway ejecuta el proceso que coordina el trabajo con los audios. AssemblyAI transcribe el audio; Anthropic genera borradores y respuestas de ayuda; Twilio envía recordatorios por SMS; Resend envía los correos para recuperar el acceso. Cada servicio recibe la información necesaria para su tarea. Este borrador no establece países de alojamiento ni plazos contractuales: deben revisarse antes de publicar el texto definitivo." },
  { titulo: "El consentimiento de tus pacientes", texto: "La profesional es responsable de obtener el consentimiento de sus pacientes para cargar y procesar sus datos y para grabar las sesiones, y de explicarles cómo se usa la aplicación. Revisar y aprobar cada nota también queda a su cargo." },
  { titulo: "Cómo pedir la baja", texto: "Para pedir la baja de tu cuenta, contactá a quien administra Sesión por el canal con el que recibiste acceso. Hoy no hay una baja automática en la app. Quedan pendientes de definir y publicar el canal de contacto definitivo, los pasos para entregar o eliminar la información y el tratamiento de las copias de respaldo." },
  { titulo: "Texto pendiente", texto: "Este contenido es un borrador de trabajo para que el responsable de Sesión lo reescriba y lo revise con asesoramiento legal. No presenta condiciones jurídicas definitivas ni certifica cumplimiento de una norma." },
] as const;
