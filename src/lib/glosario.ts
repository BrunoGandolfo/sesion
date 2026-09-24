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
import type { FrecuenciaTurno, MetodoPago } from "@/types/domain";
import { ESPERA_ENTRE_INVITACIONES_DIAS, TOPE_GRABACIONES_PRUEBA, TOPE_INVITACIONES_TOTAL } from "@/lib/limites-prueba";

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
/** La tercera pestaña. Se llamó "Ficha" adentro de la ficha, y lo que tiene
 *  son datos administrativos: contacto, tarifa, autorización, pagos. */
export const DATOS = "Datos";
/** Marca de la sesión de hoy dentro de la lista de sesiones. */
export const SESION_DE_HOY = "Hoy";

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

/** Reemplaza a "Resumen acumulativo". */
export const EL_RECORRIDO_HASTA_HOY = "El recorrido hasta hoy";

/** Reemplaza a "Evolución clínica". */
export const COMO_VA = "Cómo va";

/** Botón del Recorrido que abre la hoja de impresión. */
export const EXPORTAR_PDF = "Exportar PDF";

/** Botón de la hoja de impresión: el diálogo del navegador ofrece las dos cosas. */
export const IMPRIMIR_O_GUARDAR_PDF = "Imprimir o guardar PDF";

/** Pie de cada página del PDF del Recorrido. */
export function pieRecorridoPdf(nombreProfesional: string | null): string {
  return `Archivo personal de ${nombreProfesional ?? "la profesional"}. Contiene información clínica confidencial.`;
}

/** El mismo resumen, en la ficha: un bloque plegado debajo del título de la
 *  lista de sesiones. Se abre solo cuando la ficha se pide con ?preparar=1.
 *  El mismo rótulo lo usan Hoy (la tarjeta de ahora y el resumen corto) y el
 *  detalle del turno de Agenda como enlace a /pacientes/[id]?preparar=1. */
export const PREPARAR_SESION = "Preparar sesión";

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

/** El mismo rechazo, diciendo contra qué turno choca: sin eso, la
 *  profesional prueba horarios a ciegas. `desde` y `hasta` en hora de
 *  Montevideo ("10:00", "10:50"). */
export function TURNO_SOLAPADO_CON(
  paciente: string,
  desde: string,
  hasta: string,
): string {
  return `Ya tenés un turno a esa hora: ${paciente}, de ${desde} a ${hasta}. Elegí otro horario, o cancelá el que está.`;
}

/**
 * El mismo rechazo, cuando el turno que ocupa el lugar EMPEZÓ otro día: uno
 * de 23:40 que termina 00:30 le come la medianoche al día siguiente. Con sólo
 * las horas, el día que ella está mirando parecía libre y el mensaje hablaba
 * de un horario que no veía por ningún lado.
 */
export function TURNO_SOLAPADO_CON_DIA(
  paciente: string,
  dia: string,
  desde: string,
  hasta: string,
): string {
  return `Ya tenés un turno a esa hora: ${paciente}, del ${dia} de ${desde} a ${hasta}. Elegí otro horario, o cancelá el que está.`;
}

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
  pendiente: "Programado", enviando: "Enviando", aceptado: "En camino",
  entregado: "Entregado", no_entregado: "No llegó", cancelado: "Cancelado",
  fallido: "No salió", desconocido: "No sabemos si salió",
};

// ────────────────────────────────────────────────────────────────────────────
// Grabación
// ────────────────────────────────────────────────────────────────────────────

export const GRABAR_SESION = "Grabar sesión";

/** Estado de la grabación detenida a propósito, no por un corte. */
export const EN_PAUSA = "En pausa";
export const TERMINAR_SESION = "Terminar la sesión";
export const PAUSAR = "Pausar";
export const REANUDAR = "Reanudar";

/** Un solo texto para los formularios que guardan. */
export const GUARDANDO = "Guardando…";

// ─── Después de Terminar ─────────────────────────────────────────────────────
// Tres momentos, tres textos, y algo que se mueve en pantalla: una pantalla
// quieta con un aviso de un segundo y medio se leyó como "no subió".

export const PREPARANDO_GRABACION = "Preparando la grabación…";
export const ENVIANDO_GRABACION = (porcentaje: number) =>
  `Enviando la grabación… ${porcentaje} %. No cierres esta pantalla.`;
/** Coherente con el aviso que existe de verdad (notaListaDe, más abajo): la
 *  app avisa adentro, en la pantalla en la que esté, sin notificación push. */
export const GRABACION_LLEGO =
  "La grabación llegó bien. La nota va a estar lista en unos minutos: te avisamos acá, en la app, cuando esté.";
export const VOLVER_A_LA_FICHA = "Volver a la ficha";

/** Se tocó Terminar con menos de diez segundos grabados: un toque accidental.
 *  No se sube ni se transcribe nada, y se puede volver a grabar ahí mismo. */
export const GRABACION_MUY_CORTA = "Grabaste menos de 10 segundos. No se guardó nada.";

// ─── Avisos de una grabación en curso ───────────────────────────────────────
// Son persistentes. No son toasts: un aviso que se va solo no sirve para algo
// que hay que mirar ahora. Ninguno detiene la grabación.

/** Falta poco para el tope de 150 minutos. El número sale de
 *  AVISO_LIMITE_SEGUNDOS: se avisa con 15 minutos de anticipación. */
export const AVISO_LIMITE_GRABACION = "Quedan 15 minutos de grabación";

/** Antes de empezar: el teléfono no concedió mantener la pantalla encendida
 *  (ahorro de batería, navegador sin soporte). Se dice antes, no después. */
export const AVISO_SIN_PANTALLA_ENCENDIDA =
  "Este teléfono no dejó que Sesión mantenga la pantalla encendida. Si se bloquea, la grabación se puede cortar: sacá el bloqueo automático o tocá la pantalla cada tanto.";

/** La pantalla se apagó mientras grababa o enviaba. Queda hasta que ella lo
 *  cierra: es lo que explica un hueco, y tiene que poder leerlo al volver. */
export const AVISO_PANTALLA_APAGADA =
  "La pantalla se apagó. Con la pantalla apagada el teléfono puede dejar de grabar: mantenela encendida.";
export const ENTENDIDO = "Entendido";

/** El medidor lleva dos minutos en cero con la pantalla a la vista. En sesión
 *  un silencio largo puede ser normal: se avisa y nada más. */
export const AVISO_SIN_SONIDO = "No está entrando sonido";

/** El teléfono silenció el micrófono, casi siempre por una llamada. La
 *  grabación sigue abierta y vuelve sola. */
export const AVISO_MICROFONO_SILENCIADO =
  "El teléfono silenció el micrófono (¿una llamada?). La grabación sigue abierta y vuelve sola cuando lo libere.";

const horaCorta = (epoch: number) =>
  new Date(epoch).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Hubo un rato sin audio y ya volvió. Con las horas, para que sepa qué falta. */
export const AVISO_HUECO = (desde: number, hasta: number) =>
  `No se grabó entre las ${horaCorta(desde)} y las ${horaCorta(hasta)}. Ahora está grabando de nuevo: podés seguir o terminar.`;

/** Dejó de llegar audio y todavía no volvió. */
export const AVISO_SIN_AUDIO_DESDE = (desde: number) =>
  `No está llegando audio desde las ${horaCorta(desde)}. Podés esperar a que vuelva o terminar con lo grabado.`;
export const SEGUIR_GRABANDO = "Seguir grabando";

// ─── Cuándo una grabación se detiene sola ───────────────────────────────────
// Nada cierra la sesión solo: ella decide siempre. Y sólo dos cosas detienen
// la captura sin que ella lo pida.

/** Se llegó al tope de duración. No es una falla: es el archivo que no puede
 *  crecer más. Se dice el número para que se entienda que no se rompió nada. */
export const CORTE_LIMITE =
  "Llegaste a las 2 horas y media de grabación. Lo grabado está a salvo: tocá Terminar la sesión para enviarlo.";

/** El micrófono se desconectó de verdad (otra app se lo llevó, se revocó el
 *  permiso). No se puede seguir en el mismo archivo, y pegar dos archivos lo
 *  rompe: la grabación termina acá y se guarda lo que hay. */
export const GRABACION_TERMINO_MICROFONO =
  "El micrófono se desconectó y la grabación terminó acá. No se puede continuar esta grabación: guardá lo grabado.";
export const GUARDAR_LO_GRABADO = "Guardar lo grabado";

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
export const PENDIENTE = "Sin cobrar";
export const CANCELADO = "Cancelado";

// ────────────────────────────────────────────────────────────────────────────
// Estado clínico del turno, separado del pago
// Una sesión cuya nota FALLÓ se veía en su fila sólo como "Cobrar", y desde
// Agenda "Revisar nota" llevaba a una nota fallida: la deuda tapaba el
// problema clínico y se podía cerrar el día sin notarlo. La nota tiene su
// propio rótulo, al lado del de pago, y una fallida nunca se llama "Revisar".
// ────────────────────────────────────────────────────────────────────────────

/** La nota no se pudo escribir. Lleva a la sesión, que explica qué pasó
 *  (el enlace dice VER_QUE_PASO, que ya existe más abajo, junto al aviso). */
export const NOTA_FALLIDA = "Nota fallida";
/** La nota ya está aprobada. Para "escrita y sin revisar" se usa
 *  PARA_REVISAR, que ya existe arriba. */
export const NOTA_LISTA = "Nota lista";

/** El resumen corto se muestra en dos líneas. Cuando hay más, se dice: un
 *  corte silencioso parece un resumen completo. */
export const RESUMEN_HAY_MAS = "Hay más.";
/** Una nota de esta paciente está escrita y sin revisar: el resumen no la
 *  incluye todavía. */
export const NOTA_SIN_INCORPORAR = "Hay una nota sin revisar que este resumen todavía no incluye.";
/** El Recorrido tiene una propuesta esperando decisión. */
export const PROPUESTA_SIN_INCORPORAR = "El Recorrido tiene una propuesta sin revisar.";

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

export const VOLVER_A_ESCRIBIR = "Volver a escribirla";
export const APROBAR_NOTA = "✓ Aprobar nota";
export const APROBANDO = "Aprobando…";
export const REINTENTAR = "Reintentar";
export const REINTENTANDO = "Reintentando…";
export const ELIMINAR = "Eliminar";
export const ELIMINANDO = "Eliminando…";
export const VOLVER = "Volver";

/** Confirmación de descarte: dice qué se pierde y qué se conserva. */
export const VOLVER_A_ESCRIBIR_TITULO = "¿Volver a escribir esta nota?";
export const VOLVER_A_ESCRIBIR_MENSAJE =
  "Se pide una nueva nota con la transcripción guardada. No se vuelve a transcribir.";
export const PIDIENDO_NUEVA_NOTA = "Pidiendo otra nota…";

/** Confirmación de aprobación: el audio se va para siempre. */
export const APROBAR_TITULO = "¿Aprobar esta nota?";
export const APROBAR_MENSAJE =
  "La nota queda aprobada. Se destruye la clave del audio y su borrado sigue en segundo plano, con reintentos. La aprobación no se puede deshacer.";

/** Confirmación de borrado definitivo desde el estado de error. */
export const ELIMINAR_TITULO = "¿Eliminar esta sesión?";
export const ELIMINAR_MENSAJE =
  "Se borran la sesión, la transcripción y lo generado; el audio se manda a borrar. El turno queda libre para volver a grabar. No se puede deshacer.";

/** Por qué "Aprobar nota" está deshabilitado. */
export const FALTA_REVISAR_RIESGO =
  "Marcá cada señal de riesgo antes de aprobar la nota.";
export const FALTA_REVISAR_MENCIONES = "Leé las frases para revisar y marcá «Leí las menciones» antes de aprobar.";
export const FALTA_REVISAR_AMBAS = "Revisá las señales y las menciones de la transcripción antes de aprobar.";
export const FALTA_REVISAR_VERSION = "La nota cambió. Revisá la versión actual antes de aprobar.";
export const SALIDA_TRABAJO_TITULO = "Tenés trabajo en curso";
export const SALIDA_RECORRIDO = "Tenés un borrador del Recorrido sin guardar. Si seguís, se descartan tus cambios.";
export const DESCARTAR_BORRADOR = "Se descarta este borrador sin guardar. Las versiones guardadas del Recorrido se conservan.";
export const FEEDBACK_REINTENTAR_ERROR = "No pudimos confirmar el pedido. Probá de nuevo; la nota se conserva.";
export const FEEDBACK_PEDIR = "Preparar Para vos";
export const FEEDBACK_REINTENTAR = "Volver a pedir Para vos";
export const FEEDBACK_PIDIENDO = "Pidiendo el análisis…";

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

/** Título en pantalla del bloque de gráficos del Recorrido. La pestaña tiene
 *  un solo nombre, "Recorrido"; esto nombra lo que hay adentro, no otra cosa.
 *  La hoja impresa conserva COMO_VA. */
export const INDICADORES_POR_SESION = "Indicadores por sesión";

/** Lo que son y lo que no: va siempre a la vista, debajo del título. */
export const INDICADORES_SON_ESTIMACIONES =
  "Son estimaciones que hace el sistema a partir de cada nota. Orientan; no son una medición clínica validada.";

/** Por qué la tarjeta de la última sesión está en alerta: lo dice el texto,
 *  no solo el color (en papel blanco y negro el color no se ve). */
export const ULTIMA_SESION_CON_SENAL = "Esta sesión tiene una señal de riesgo marcada.";

/** El relato acumulado del Recorrido, plegado en pantalla. */
export const RELATO_UN_PARRAFO_POR_SESION = "un párrafo por sesión";

/** Secciones del Recorrido sin contenido, en pantalla. */
export const SIN_OBJETIVOS = "Sin objetivos registrados.";
export const SIN_INTERVENCIONES = "Sin intervenciones registradas.";
export const SIN_TEMAS = "Sin temas registrados.";
export const SIN_SENALES_ANTERIORES = "Sin señales anteriores.";

// ────────────────────────────────────────────────────────────────────────────
// Recordatorio de cobro
//
// El aviso lo manda ella, apretando, una persona por vez. Por eso los textos
// dicen "Enviar SMS" y no "Notificar": se nombra el acto concreto, con el
// canal a la vista, para que sepa exactamente qué va a pasar cuando toque.
// ────────────────────────────────────────────────────────────────────────────

/** La acción secundaria de la fila del deudor. Dice el canal en el propio
 *  botón: tocarlo es empezar a mandar un mensaje, y eso se tiene que saber
 *  antes de tocar, no recién en la confirmación. */
export const RECORDAR_COBRO = "Recordar cobro por SMS";

/** La pregunta de la confirmación, con el mensaje y el número a la vista. */
export const RECORDAR_COBRO_TITULO = "¿Mandarle este mensaje?";

/** El botón que confirma. Dice el canal: sale un SMS, no una notificación. */
export const ENVIAR_SMS = "Enviar SMS";

export const ENVIANDO_SMS = "Enviando…";

/** Rótulo del número destino en la confirmación. */
export const SMS_DESTINO = "Sale a";

/** Lo que muestra la fila cuando ya se le avisó. Se completa con
 *  textoAtraso(): "Avisado hace 3 días". */
export const AVISADO = "Avisado";

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

/** Rótulo accesible del panel, para el lector de pantalla que anuncia el
 *  diálogo: "Ayuda" solo no dice ayuda de qué. */
export const AYUDA_PANEL = "Ayuda de la app";

/** La línea de bienvenida del encabezado. Dice qué puede preguntar y, en la
 *  misma respiración, lo que Lupita no ve: es la promesa de privacidad de la
 *  app, y se hace antes de que ella escriba nada. */
export const AYUDA_BIENVENIDA =
  "Preguntame cómo usar Sesión o qué turnos tenés.";

export const AYUDA_PRIVACIDAD =
  "De tu agenda veo solo nombres, días, horas, duración y modalidad. No leo fichas, teléfonos, montos, notas, transcripciones, Recorrido ni consentimientos. No cambio nada. Evitá pegar datos clínicos o personales en el chat.";

export const AYUDA_FUERA_DE_ALCANCE =
  "Puedo explicar cómo usar Sesión y consultar los turnos de hoy, mañana o esta semana de tu consultorio: nombre, día, hora, duración y modalidad. No puedo consultar teléfonos, tarifas, deudas, cobros, notas, transcripciones, Recorrido, consentimientos ni fichas, ni datos de otro consultorio. Tampoco puedo agendar, cancelar ni modificar nada.";

export const AYUDA_AGENDA_TITULOS = {
  hoy: "Estos son tus turnos de hoy, en hora de Montevideo (sin cancelados):",
  manana: "Estos son tus turnos de mañana, en hora de Montevideo (sin cancelados):",
  esta_semana: "Estos son tus turnos de esta semana, de lunes a domingo, en hora de Montevideo (sin cancelados):",
} as const;
export const AYUDA_AGENDA_VACIA = "No hay turnos en ese período.";

export const AYUDA_PREGUNTAS_INICIALES = [
  "¿Qué turnos tengo hoy?",
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
export const AYUDA_ESPERANDO = "Lupita está preparando la respuesta…";

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

/**
 * "Crear a X" crea la paciente con la tarifa de Tu consultorio. Si esa tarifa
 * no sirve —cero, o vacía— el servidor contestaba "Datos inválidos" recién al
 * enviar, sin decir qué faltaba ni dónde se carga. Ahora se dice antes.
 */
export const TARIFA_SIN_CARGAR =
  "Para crear una paciente desde acá necesitás una tarifa por sesión mayor a cero. Cargala en Tu consultorio y volvé.";

/**
 * La paciente ya quedó creada: si el turno se rechaza y ella corrige el
 * nombre acá, esos cambios no van a ningún lado (el reenvío usa la que ya
 * existe). Antes los campos seguían editables y no lo decían.
 */
export const PACIENTE_YA_CREADA =
  "Ya la creaste. Si hay que corregir algo, se hace desde su ficha.";

/** Los puntos del mes: dorado y verde no se explican en ningún lado de esa
 *  pantalla, y son el único dato de la grilla. */
export const MES_LEYENDA = "Cada punto es un turno:";

/** El punto gris del mes es el mismo para los dos: el turno está en la
 *  agenda pero no hubo sesión. Se dicen juntos porque comparten el color, y
 *  decir sólo uno hacía que un turno cancelado pareciera un error de la
 *  pantalla. */
export const MES_LEYENDA_SIN_SESION = "No vino o cancelado";

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
 * pantalla.
 */
export const SIN_COBRAR = "Sin cobrar";

/** La otra vista de Cobros: los pagos que entraron este mes. */
export const COBROS_DEL_MES = "Cobros del mes";

/** Rótulo accesible del control que cambia entre las dos vistas. */
export const VISTA_DE_COBROS = "Vista de cobros";

/** El titular del bloque de deuda: la deuda se cuenta en sesiones, que es
 *  como ella la piensa. Se completa con el número. */
export const SIN_COBRAR_FRASE_FINAL = "sin cobrar.";

// ─── Registrar un pago desde Te deben ───────────────────────────────────────
// La acción principal de cada fila: ella viene a esta pantalla cuando le
// pagaron, no cuando quiere reclamar. El cobro sigue siendo por sesión: se
// eligen las sesiones que pagó y después el método, una sola vez para todas.
// La confirmación es COBRADO, la misma de Hoy.

/** El botón principal de la fila. */
export const REGISTRAR_PAGO = "Registrar pago";

/** La pregunta del panel, arriba de la lista de sesiones sin cobrar. */
export const REGISTRAR_PAGO_TITULO = "¿Qué sesiones te pagó?";

/** Atajo cuando hay más de una: lo común es que pague todo junto. */
export const MARCAR_TODAS = "Marcar todas";

/** El botón que sigue al selector de método. Deshabilitado sin sesiones
 *  marcadas. */
export const ELEGIR_METODO_DE_PAGO = "Elegir método de pago";

/** Mientras llega el detalle de las sesiones de esa paciente. */
export const BUSCANDO_SESIONES = "Buscando sus sesiones…";

/** No se pudo traer el detalle. */
export const SESIONES_NO_CARGARON = "No pudimos traer sus sesiones.";

/** La lista llegó vacía: se cobró desde otro lado mientras tanto. */
export const YA_NO_DEBE = "Ya no tiene sesiones sin cobrar.";

/** Se eligieron varias y una falló en el medio: se dice cuántas quedaron. */
export function COBRO_INCOMPLETO(registradas: number, elegidas: number): string {
  return `Quedaron registradas ${registradas} de ${elegidas}. Probá de nuevo con las que faltan.`;
}

// ─── Estado vacío: nadie debe nada ──────────────────────────────────────────
// Es la única confirmación alegre que 04-personaje.md le permite a Cobros, y
// por eso es el único lugar de esta pantalla donde aparece Lupita.

export const NADIE_TE_DEBE = "Nadie te debe";
export const NADIE_TE_DEBE_LINEAS = [
  "Todas las sesiones realizadas están cobradas.",
  "Cuando cobres un turno desde la agenda, el pago aparece en Cobros del mes.",
  "Si alguien queda sin pagar, va a aparecer acá para que registres el pago cuando te pague.",
] as const;

/** El botón del estado vacío: lleva a la otra vista. */
export const VER_COBROS_DEL_MES = "Ver cobros del mes";

// ─── Estado vacío: todavía no entró nada este mes ───────────────────────────
// Este no se celebra: no cobrar nada en un mes no es una buena noticia. Va
// con el ícono de siempre y sin personaje.

export const SIN_COBROS_ESTE_MES = "Todavía no cobraste este mes";
export const SIN_COBROS_ESTE_MES_LINEAS = [
  "Los cobros se registran desde Te deben, o desde el turno en la agenda o en Hoy.",
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
export const NOTA_APROBADA_AVISO = "Nota aprobada. El audio se borra en segundo plano.";

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
// Es institucional: describe también la ayuda de Lupita, sin montar el
// personaje ni abrir el chat antes del ingreso.
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
export const ESLOGAN = "Un lugar para tu trabajo clínico";

/** Una frase concreta de entrada, centrada en el trabajo clínico. */
export const ENTRADA_QUE_HACE =
  "Sesión reúne la organización del consultorio y la documentación clínica de cada paciente, con asistencia de inteligencia artificial y revisión profesional.";

/**
 * Las tres cosas que hace, una línea cada una y en este orden: la nota
 * primero, porque es el motivo por el que alguien instalaría esto; después
 * lo administrativo; al final el análisis, que es lo que ninguna otra
 * promete.
 *
 * La primera nombra a la profesional como quien decide ("la aprobás vos"):
 * es la misma regla que sostiene toda la app —el borrador se llama borrador
 * hasta que ella lo firma, ver [[BORRADOR]]—
 * y en la pantalla de entrada es, además, la respuesta a la primera objeción
 * que tiene cualquier psicóloga frente a una nota escrita por una máquina.
 */
export const ENTRADA_AFIRMACIONES = [
  "La IA prepara un borrador de nota clínica y la aprobás vos.",
  "Agenda, recordatorios por SMS y cobros.",
  "Un análisis de la sesión para reflexionar sobre tu práctica.",
] as const;

/** Almacenamiento cifrado de lo escrito; del audio sólo afirma lo que es
 * cierto (viaja por TLS: la app no lo cifra). No afirma cifrado de extremo a
 * extremo ni incluye los datos administrativos o las copias exportadas. */
export const ENTRADA_CONFIDENCIALIDAD =
  "El audio viaja por una conexión cifrada. Las notas, las transcripciones, el análisis y el Recorrido se guardan cifrados.";

// Portada. Cada afirmación tiene que ser cierta en el código de hoy: si el
// comportamiento cambia, el texto cambia con él.
export const PORTADA_ACCESO = "Entrar a tu cuenta";
export const PORTADA_FUNCIONES_TITULO = "De la agenda al Recorrido";
export const PORTADA_FUNCIONES = [
  {
    titulo: "Agenda, recordatorios y cobros",
    parrafos: [
      "Organizá turnos únicos o recurrentes y activá recordatorios por SMS. Registrá los cobros y consultá las deudas de cada paciente.",
    ],
  },
  {
    titulo: "De la sesión a la nota clínica",
    parrafos: [
      "Con autorización de la paciente, grabá la sesión. El audio se transcribe y la IA prepara un borrador de nota SOAP: Subjetivo, Objetivo, Análisis y Plan. Vos lo revisás, corregís y aprobás.",
    ],
  },
  {
    titulo: "El Recorrido de cada paciente",
    parrafos: [
      "Un historial longitudinal del proceso. Después de aprobar una nota, la IA propone cómo incorporar esa sesión al Recorrido. Vos decidís si aceptás, editás o descartás la propuesta.",
      "Podés exportar el Recorrido a PDF desde la impresión del navegador. Esa copia queda sin cifrar, bajo tu cuidado.",
    ],
  },
  {
    titulo: "Una lectura de tu trabajo",
    parrafos: [
      "Para vos ofrece un análisis de la sesión a partir de la transcripción, con observaciones sobre tus intervenciones. Es una herramienta de reflexión; no reemplaza la supervisión clínica.",
    ],
  },
] as const;
export const PORTADA_CIFRADO = "Datos clínicos cifrados";
export const PORTADA_LUPITA_TITULO = "Lupita, para orientarte";
export const PORTADA_LUPITA =
  "Lupita explica cómo usar Sesión y consulta tu agenda de hoy, mañana o esta semana: nombres, días, horas, duración y modalidad. No lee fichas, teléfonos, montos, notas, transcripciones, Recorrido ni consentimientos. No cambia nada.";
export const PORTADA_LUPITA_CUIDADO =
  "Sí recibe lo que escribís en el chat: evitá incluir datos clínicos o personales.";
export const PORTADA_PIE = "© Mariana Roldán";

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
export const CORREO_FIRMA = `Sesión · ${ESLOGAN}`;

// Entrada — invitaciones, alta y términos provisionales
export const ENTRADA_REGISTRO = "Crear mi cuenta";
export const ENTRADA_NOMBRE = "Tu nombre";
export const ENTRADA_ACEPTA_TERMINOS = "Acepto los términos y la política de privacidad";
export const ENTRADA_TERMINOS_REQUERIDOS = "Para crear tu cuenta necesitás aceptar los términos y la política de privacidad.";
export const ENTRADA_INVITACION_INVALIDA = "Este enlace venció o ya se usó.";
export const ENTRADA_PEDIR_INVITACION = "Pedile otro a quien te invitó";
export const ENTRADA_REGISTRO_ERROR = "No pudimos crear la cuenta con esos datos. Revisalos o probá entrar con tu cuenta.";
export const INVITAR_COLEGA = "Invitar a una colega";
export const INVITAR_DESCRIPCION = "La invitación es para que una colega pruebe Sesión, no para usarla como su consultorio. Crea un consultorio de prueba, separado del tuyo, que puede grabar hasta " + TOPE_GRABACIONES_PRUEBA + " sesiones en total. El enlace vence en 7 días y se usa una sola vez. Compartilo sólo con ella.";
export const INVITAR_LIMITES = "Podés generar " + TOPE_INVITACIONES_TOTAL + " invitaciones en total, una cada " + ESPERA_ENTRE_INVITACIONES_DIAS + " días.";
export const INVITAR_RESTANTES = (n: number) => n === 1 ? "Te queda 1 invitación." : "Te quedan " + n + " invitaciones.";
export const INVITAR_AGOTADAS = "Ya generaste las " + TOPE_INVITACIONES_TOTAL + " invitaciones de tu cuenta. No podés generar más.";
/** `cuando`: "17 de octubre de 2026 a las 15:30". */
export const INVITAR_ESPERA = (cuando: string) => "Generaste una invitación hace menos de " + ESPERA_ENTRE_INVITACIONES_DIAS + " días. Vas a poder generar la próxima desde el " + cuando + ".";
export const PRUEBA_AVISO = (usadas: number) => "Estás probando Sesión: este consultorio puede grabar hasta " + TOPE_GRABACIONES_PRUEBA + " sesiones. Llevás " + usadas + ".";
export const PRUEBA_CERCA = (restantes: number) => (restantes === 1 ? "Te queda 1 sesión" : "Te quedan " + restantes + " sesiones") + " para grabar de las " + TOPE_GRABACIONES_PRUEBA + " de la prueba.";
export const PRUEBA_TOPE = "Llegaste a las " + TOPE_GRABACIONES_PRUEBA + " sesiones grabadas de la prueba y no podés grabar más. Para seguir, hablá con quien te invitó. La agenda, los pacientes, los cobros y lo demás siguen funcionando.";
export const INVITAR_GENERAR = "Generar enlace";
export const INVITAR_ENLACE = "Enlace de invitación";
export const INVITAR_COPIAR = "Copiar";
export const INVITAR_COPIADO = "Enlace copiado";
export const INVITAR_WHATSAPP = "Compartir por WhatsApp";
export const INVITAR_MENSAJE = "Te invito a probar Sesión. Con este enlace creás un consultorio de prueba, que puede grabar hasta " + TOPE_GRABACIONES_PRUEBA + " sesiones. Vence en 7 días:";
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

// Textos integrados de las áreas de Fase 3.
export const PASSWORD_AVISO_CIERRE =
  "Al cambiarla te vamos a pedir que entres de nuevo en todos tus dispositivos, este incluido.";
/** Tu consultorio: salir con un dato inválido o un guardado que falló. */
export const CONFIG_SIN_GUARDAR_SALIDA =
  "Hay cambios en Tu consultorio que no se pudieron guardar. Si salís ahora, se pierden.";
export const OTRAS_SESIONES_BOTON = "Cerrar sesión en los demás dispositivos";
export const OTRAS_SESIONES_DESCRIPCION =
  "Si perdiste un teléfono o entraste desde una computadora ajena, esto cierra todas las demás sesiones. Esta sigue abierta.";
export const OTRAS_SESIONES_CERRANDO = "Cerrando…";
export function otrasSesionesCerradas(n: number): string {
  if (n === 0) return "No había otras sesiones abiertas.";
  return n === 1 ? "Cerramos 1 sesión en otro dispositivo." : `Cerramos ${n} sesiones en otros dispositivos.`;
}
export const SERIE_AGENDADA = (n: number) => `${n} turnos agendados`;
export const SERIE_OMITIDAS = (fechas: string[]) =>
  fechas.length === 1
    ? `No se agendó el ${fechas[0]}: ya había un turno a esa hora.`
    : `No se agendaron ${fechas.length} fechas por choque de horario: ${fechas.join(", ")}.`;
export const CANCELAR_SERIE = "Cancelar el resto de la serie";
export const CANCELAR_SERIE_TITULO = "¿Cancelar este turno y los que siguen?";
export const CANCELAR_SERIE_MENSAJE =
  "Se cancelan este turno y todos los siguientes de la serie que todavía estén programados, con sus recordatorios. Los ya realizados y los anteriores quedan como están.";
export const CANCELAR_SERIE_ACCION = "Cancelar el resto";
export const SERIE_CANCELADA = (n: number) =>
  n === 1 ? "Se canceló 1 turno de la serie" : `Se cancelaron ${n} turnos de la serie`;
export const AYUDA_SERIE =
  "Se agendan tres meses de turnos, cada uno independiente: podés mover o cancelar cualquiera sin tocar el resto.";
export const MENSAJE_SIN_SERIE = "Este turno no es parte de una serie";
export const MENSAJE_NO_REABRIR = "No se puede reabrir un turno cancelado";
export const MENSAJE_SOLO_PROGRAMADOS =
  "Solo se pueden editar datos de turnos programados";
export const MENSAJE_HOT_WORD_DUPLICADA = "Hot word duplicado";
export const MENSAJE_FALTA_PACIENTE =
  "pacienteId es obligatorio cuando scope === 'paciente'";

export const SE_REPITE = "Se repite";
export const LEI_LAS_MENCIONES = "Leí las menciones";
export const CUENTA_INVITAR_NO_PERMITIDO = "No podés invitar desde esta cuenta.";
export const CUENTA_PASSWORD_INCORRECTA = "La contraseña actual no es correcta";
export const CUENTA_PASSWORD_NO_DISPONIBLE = "No se pudo procesar el cambio de contraseña en este momento. Probá de nuevo.";
export const CUENTA_ENTRADA_NO_DISPONIBLE = "No pudimos procesar la entrada en este momento. Probá de nuevo.";
export const FRECUENCIA_LABEL: Readonly<Record<FrecuenciaTurno, string>> = {unico:"Una vez",semanal:"Cada semana",quincenal:"Cada 15 días"};
export const SESION_FALLO_LABEL: Readonly<Record<string, string>> = {intentos_agotados:"Se intentó cinco veces seguidas y no salió.",grabacion_abandonada:"La grabación quedó a medias."};
export const FEEDBACK_ESTADO_LABEL = {no_pedido:"Todavía no se pidió.",pendiente:"Se está generando…",listo:"Listo",fallido:"No se pudo generar."} as const;

export const SMS_MOTIVOS = {
  "CREDENCIALES": "el servicio de SMS rechazó las credenciales",
  "TELEFONO_INVALIDO": "el teléfono no es válido",
  "EMISOR_INVALIDO": "el número emisor no está bien configurado",
  "INALCANZABLE": "el teléfono no se puede alcanzar",
  "PAIS_NO_HABILITADO": "el servicio de SMS no tiene habilitado el país de destino",
  "EMISOR_SIN_SMS": "el número emisor no puede mandar SMS",
  "BAJA": "la paciente pidió no recibir más mensajes",
  "NO_CELULAR": "el teléfono no es un celular",
  "SIN_SENAL": "el teléfono estaba apagado o sin señal",
  "INEXISTENTE": "el número no existe o ya no está en servicio",
  "LINEA_FIJA": "el número es una línea fija o el operador no lo recibe",
  "BLOQUEADO": "el operador bloqueó el mensaje",
  "RECHAZADO": "el servicio de SMS rechazó el envío",
  "NO_ENTREGADO": "el operador no lo entregó"
} as const;
// La baja abarca todas las cuentas que envían a ese teléfono: no tiene una
// única profesional a la cual atribuir este acuse.
export const SMS_BAJA_CONFIRMADA = "Consultorio: no vas a recibir más SMS";
export const SMS_CON_CODIGO = (texto: string, codigo: number | null) => codigo === null ? texto : texto + " (" + codigo + ")";

export const ENTRADA_REINGRESO =
  "Cambiaste la contraseña: entrá de nuevo en todos tus dispositivos.";

export const MOTIVO_SIN_TELEFONO = "la paciente no tiene teléfono cargado";

export const MOTIVO_TURNO_CERRADO = "el turno dejó de estar programado";

export const MOTIVO_REPROGRAMADO = "el turno se reprogramó: sale un aviso nuevo";

export const MOTIVO_BAJA = "la paciente pidió no recibir más mensajes";

export const MOTIVO_TURNO_PASADO = "el turno ya pasó";

export const MOTIVO_RESERVA_HUERFANA =
  "una corrida se cortó después de llamar al servicio de SMS: no se sabe si el mensaje salió";

export const MOTIVO_SIN_TEXTO_DE_COBRO = "no hay deuda vigente para avisar";

export const MENSAJE_ENVIADO_TRAS_CANCELACION =
  "El SMS salió, pero el turno se cerró mientras se enviaba: la paciente recibió un aviso de una sesión que ya no está programada";

export const MOTIVO_PACIENTE_DADA_DE_BAJA = "La paciente pidió no recibir más mensajes";

export const MOTIVO_VENTANA_AGOTADA =
  "no se pudo enviar antes de la sesión: el servicio de SMS no respondió a tiempo";

export const MOTIVO_VENTANA_AGOTADA_SIN_TURNO =
  "no se pudo enviar en el día: el servicio de SMS no respondió a tiempo";

export const REMITENTE_SMS = "Consultorio {{profesional}}";

export const LINEA_CONTACTO = "Cambios: llamar al {{telefonoConsultorio}}";

export const TEMPLATE_SMS_SUGERIDO = `${REMITENTE_SMS}\n{{nombre}}, tu turno es el {{fecha}} a las {{hora}}. ${LINEA_CONTACTO}`;

export const TEMPLATE_SMS_CON_DIRECCION = `${REMITENTE_SMS}\n{{nombre}}, tu turno es el {{fecha}} a las {{hora}}.\n{{direccion}}\n${LINEA_CONTACTO}`;

export const PLANTILLA_CAMBIO_DE_HORARIO = `${REMITENTE_SMS}\n{{nombre}}, tu turno cambió al {{fecha}} a las {{hora}}. ${LINEA_CONTACTO}`;

export const TEMPLATE_COBRO_DEFAULT = `${REMITENTE_SMS}\n{{nombre}}, tenés {{sesiones}} sesión/es pendiente/s de pago: {{monto}}.`;

export const FEEDBACK_ESPERA = "El análisis está en preparación. Podés seguir trabajando; lo vas a encontrar acá cuando esté listo.";
export const FEEDBACK_NO_DISPONIBLE = "El análisis figura listo, pero no pudimos mostrar su contenido. Volvé a abrir la sesión para comprobarlo.";

export const SALIDA_NOTAS_PRIVADAS = "Las notas privadas todavía no se guardaron. Quedate hasta que aparezca «Guardado» o salí descartando estos cambios.";
export const DESCARTAR_PROPUESTA = "Esta propuesta queda descartada. El Recorrido vigente y las versiones anteriores se conservan.";

export const DESCARTAR_BORRADOR_ACCION = "Descartar borrador";
export const QUITAR_ELEMENTO_BORRADOR = "Se quita este elemento del borrador. Las versiones guardadas del Recorrido se conservan.";

export const APROBAR_DESCARTA_ANTERIOR = "Al aprobar esta nota se descarta la copia de tu borrador anterior. Si querés conservar alguno de esos cambios, incorporalo a esta nota antes de aprobar.";

// ────────────────────────────────────────────────────────────────────────────
// Nota en proceso y aviso de nota lista
//
// Mientras el worker escribe (3 a 10 minutos) la ficha y Hoy lo muestran con
// un anillo que gira y el nombre de la paciente; cuando termina, un aviso que
// se queda hasta que ella lo toca, en cualquier pantalla
// (src/components/layout/avisos-de-notas.tsx).
// ────────────────────────────────────────────────────────────────────────────

/** El renglón de la ficha y de Hoy mientras se escribe la nota. */
export function procesandoSesionDe(paciente: string): string {
  return `Procesando la sesión de ${paciente}`;
}

/** Debajo de "Procesando…": cuánto tarda y que no hace falta quedarse. */
export const PROCESANDO_DETALLE =
  "Tarda unos minutos. Podés seguir con lo tuyo: te avisamos acá cuando la nota esté lista.";

export function notaListaDe(paciente: string): string {
  return `La nota de ${paciente} está lista`;
}

export const REVISAR = "Revisar";

export function notaFallidaDe(paciente: string): string {
  return `No pudimos escribir la nota de ${paciente}`;
}

export const VER_QUE_PASO = "Ver qué pasó";

// ────────────────────────────────────────────────────────────────────────────
// Pantalla de la sesión: transcripción, índice de la nota e instrumento
// ────────────────────────────────────────────────────────────────────────────

/** Tercera vista de la sesión, junto a la nota y "Para vos". */
export const TRANSCRIPCION = "Transcripción";

export const TRANSCRIPCION_SUBTITULO = "Lo que se dijo en la sesión, tal como quedó escrito.";

/** Quién habla lo decidió el sistema, no ella: se dice siempre, arriba. */
export const TRANSCRIPCION_HABLANTES =
  "Quién habla en cada parte lo asignó el sistema automáticamente y puede estar equivocado.";

export const TRANSCRIPCION_ABRIENDO = "Abriendo la transcripción…";

/** 409: la sesión existe pero su texto todavía no. */
export const TRANSCRIPCION_SIN_TEXTO_TITULO = "Todavía no hay transcripción";
export const TRANSCRIPCION_SIN_TEXTO =
  "El texto de esta sesión todavía no está escrito. Volvé a probar en unos minutos.";

export const TRANSCRIPCION_ERROR_TITULO = "No pudimos abrir la transcripción";

export const BUSCAR_EN_TRANSCRIPCION = "Buscar en la transcripción";
export const BUSCAR_PLACEHOLDER = "Buscar una palabra";
export const BUSCAR_ANTERIOR = "Resultado anterior";
export const BUSCAR_SIGUIENTE = "Resultado siguiente";
export const BUSCAR_BORRAR = "Borrar la búsqueda";
export const BUSCAR_MINIMO = "Escribí al menos 2 letras.";

export function resultadoDeBusqueda(actual: number, total: number): string {
  return `${actual} de ${total}`;
}

export function busquedaSinResultados(consulta: string): string {
  return `No aparece «${consulta}» en esta transcripción.`;
}

/** aria-label del índice de la nota. */
export const INDICE_NOTA = "Secciones de la nota";

/** "Para vos": el instrumento va después de las observaciones, plegado. */
export const INSTRUMENTO_Y_PUNTAJE = "El instrumento y su puntaje";

// ── agenda-tocable ──────────────────────────────────────────────────────
// El cuerpo de la fila de turno lleva a la ficha de la paciente; el detalle
// del turno (reprogramar, cancelar, cobrar) queda en un control aparte, a la
// derecha. La fila es la misma en Hoy y en Agenda.
export const VER_TURNO = "Ver turno";
