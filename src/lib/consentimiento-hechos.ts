// Los HECHOS que respaldan cada frase del consentimiento informado.
//
// El texto del consentimiento (src/lib/consentimiento.ts) no se escribe a
// mano: se genera desde estas constantes, y consentimiento.test.ts ata cada
// frase a la constante que la respalda. Si el pipeline cambia, cambia acá la
// constante, y el texto y el test se mueven juntos. Un consentimiento que
// describe mal el tratamiento no es consentimiento informado (Ley 18.331).
//
// Módulo PURO: lo importa un componente cliente (ConsentimientoForm).
//
// Quién mantiene cada hecho: al lado de cada uno. Cambiarlo sin que cambie
// el código que lo hace verdadero es mentirle a la paciente por escrito.

/** Proveedores externos que tocan datos de la sesión. */
export const PROVEEDORES = {
  r2: { nombre: "Cloudflare R2", rol: "almacenamiento del audio cifrado" },
  railway: { nombre: "Railway", rol: "servidor del proceso que transcribe y redacta" },
  neon: { nombre: "Neon", rol: "base de datos" },
  assemblyai: { nombre: "AssemblyAI", rol: "transcripción", pais: "Estados Unidos" },
  anthropic: { nombre: "Anthropic", rol: "redacción de la nota", pais: "Estados Unidos" },
} as const;

/** Solo audio: getUserMedia sin video (área 1, captura). */
export const MEDIOS_CAPTURA = ["audio"] as const;

/**
 * DESACTUALIZADO A PROPÓSITO (rama grabador-dhh, 18/9/2026). La app dejó de
 * cifrar el audio: los trozos se guardan como Blob (src/lib/grabacion-storage.ts)
 * y el archivo se sube tal cual. Estas tres banderas NO se cambiaron porque
 * cambiarlas cambia el texto del consentimiento, y una versión nueva del texto
 * —que las pacientes vuelven a firmar— la decide el dueño. Las frases que
 * dejaron de ser ciertas están en
 * docs/pendientes/consentimiento-sin-cifrado-de-audio.md.
 */
export const RESPALDO_LOCAL_CIFRADO = true;

/** El archivo se sube entero al terminar, no por tramos mientras se graba
 * (useGrabacionSesion.subirAudio: upload-url → PUT → upload-confirmar). Esto
 * sigue siendo cierto. */
export const AUDIO_SE_SUBE_AL_TERMINAR = true;

/** Ver la nota de RESPALDO_LOCAL_CIFRADO: ya no hay clave por sesión. */
export const CLAVE_POR_SESION = true;

/**
 * El vocabulario que la profesional carga (hot words) viaja a AssemblyAI
 * como keyterms_prompt, y puede incluir nombres propios (decisión del
 * dueño: sí viajan, y el consentimiento lo dice).
 */
export const VOCABULARIO_A_ASR = true;
export const VOCABULARIO_INCLUYE_NOMBRES = true;

/**
 * El borrado en AssemblyAI tiene dos partes, y el texto tiene que contar las dos:
 *
 * 1. Inmediato: asr_assemblyai.transcribir() pide DELETE en el `finally` que
 *    envuelve la espera del transcript, salga bien o mal. Es de mejor
 *    esfuerzo: un solo pedido, sin reintento, sólo loguea el status.
 * 2. Durable: sólo si la transcripción se completó, processor.py registra el
 *    id (registrar_asr) y la app crea borrar_transcript_asr en la misma
 *    transacción. Ese trabajo reintenta con la política de
 *    trabajos/politica.ts (20 intentos, unas dos semanas) y trabajos/resolver
 *    lo deja `fallido` al agotarlos.
 *
 * Lo que NO cubre el durable: una transcripción que falla o vence (queda sólo
 * el pedido inmediato), un proceso que muere antes de ese pedido, un audio
 * subido cuyo transcript no llegó a crearse (no hay id que borrar) y un
 * registro del id que falla (processor.py lo loguea y sigue).
 */
export const ASR_BORRADO_CON_REINTENTO = true;
export const ASR_BORRADO_INMEDIATO = true;
/** El reintento durable existe sólo si la transcripción se completó. */
export const ASR_REINTENTO_SOLO_SI_SE_COMPLETO = true;
export const ASR_BORRADO_MAX_INTENTOS = 20;
export const ASR_BORRADO_DIAS_APROX = 15;
/** processor.borrar_transcript_asr: 200 (borrado) y 404 (no existe) son hecho.
 * Un 404 no distingue "lo borró antes" de "nunca existió con ese id". */
export const ASR_CONFIRMACION_HTTP = [200, 404] as const;

/** Anthropic recibe la transcripción y el hilo vigente del paciente. */
export const LLM_RECIBE_CONTEXTO = true;

/** hilo/trabajo.ts (adjuntoContexto): para proponer el Recorrido, Anthropic
 * recibe la nota APROBADA (notaFinal, con las correcciones de la
 * profesional), sus datos y el Recorrido vigente. La lista de palabras no le
 * llega: sólo va a AssemblyAI (clinical_analyzer.py no la usa). */
export const LLM_RECIBE_NOTA_APROBADA = true;
export const VOCABULARIO_SOLO_A_ASR = true;

/** ayuda/agenda.ts: select cerrado y organización de la sesión autenticada.
 * Lupita no recibe fichas ni registros clínicos. La respuesta la arma el
 * servidor; si la conversación continúa, puede viajar en su historial. */
export const LUPITA_CONSULTA_AGENDA = true;
export const LUPITA_CAMPOS_AGENDA = ["nombre", "dia", "hora", "duracion", "modalidad"] as const;
export const LUPITA_SOLO_LECTURA = true;
/** responder-ayuda.ts: historialAMensajes envía preguntas y respuestas. */
export const LUPITA_HISTORIAL_A_ANTHROPIC = true;

/** clinical_analyzer.py usa el mismo proveedor/modelo para la nota y el
 * resumen. hilo/trabajo.ts sólo crea una propuesta; hilo/escribir.ts exige
 * la decisión de la profesional para hacerla vigente o rechazarla. */
export const RESUMEN_PROPUESTO_POR_IA = true;

/** processor.py: descargar_y_descifrar descifra en memoria y transcribir
 * manda esos bytes al ASR desde memoria (io.BytesIO). No se escribe ningún
 * archivo con audio en claro en el servidor. */
export const AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL = false;

/** sesion/resultado.ts guarda la nota de la IA (notaIa), cifrada, apenas
 * llega: antes de que la profesional la apruebe. Al aprobar se guarda aparte
 * la nota final y el borrador se conserva (se ve como "borrador original"). */
export const BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR = true;

/** grabar-view.tsx llama a limpiarGrabacion (grabacion-storage.ts) apenas
 * upload-confirmar responde OK: la copia cifrada del teléfono se borra con
 * la subida confirmada. Hasta ese momento se conserva, cifrada, para poder
 * reintentar. */
export const COPIA_LOCAL_CIFRADA_SE_CONSERVA = false;

/** Workspace de Anthropic con retención deshabilitada. Verificado en la
 *  consola el 2026-09-04 (docs/operaciones.md §1). Renovar la fecha a mano. */
export const ANTHROPIC_RETENCION_CERO = true;
export const ANTHROPIC_RETENCION_VERIFICADA_EL = "2026-09-04";

/** El borrado del audio en R2 es un trabajo durable (borrar_audio_r2) y la
 *  clave se destruye en la transacción que aprueba la nota. Área 2. */
export const LIMPIEZA_AUDIO_REINTENTA = true;
/** trabajos/politica.ts: 20 intentos, con unas dos semanas de esperas.
 * trabajos/resolver.ts deja el trabajo fallido cuando se agotan. No es un
 * plazo exacto: depende también de que corra el servicio de borrado. */
export const LIMPIEZA_AUDIO_MAX_INTENTOS = 20;
export const LIMPIEZA_AUDIO_DIAS_APROX = 15;
/** sesion/aprobar.ts: audioClave:null dentro de la transacción, haya o no
 * archivo en R2. No elimina las claves incluidas en respaldos anteriores. */
export const CLAVE_AUDIO_DESTRUIDA_AL_APROBAR = true;

/** Backups diarios de la base (.github/workflows/backup.yml), retención en días. */
export const RETENCION_BACKUPS_DIAS = 30;
/** El mismo workflow conserva mensuales 366 días (hasta 12 meses).
 * consentimiento-retencion.test.ts ejecuta esa limpieza con R2 simulado
 * y compara sus plazos con estos hechos y con el texto generado. */
export const RETENCION_BACKUPS_MENSUALES_DIAS = 366;
export const RETENCION_BACKUPS_MENSUALES_MESES = 12;
/** El dump incluye la clave del audio (cifrada) de las sesiones no aprobadas. */
export const BACKUP_INCLUYE_CLAVE_AUDIO = true;

/** Revocar el consentimiento no borra lo ya guardado (DELETE solo revoca). */
export const REVOCAR_BORRA_HISTORIA = false;

/** Cada lectura de una nota queda registrada (eventos_auditoria). */
export const ACCION_VER_SESION = "sesion.ver";

/**
 * La profesional puede imprimir el Recorrido o guardarlo como PDF para su
 * archivo: la hoja de impresión de /pacientes/[id]/recorrido/imprimir. Esa
 * copia sale de la aplicación sin cifrar. Cada exportación queda registrada
 * con esta acción (casos-uso/hilo/exportar.ts la escribe en la misma
 * transacción que lee el Recorrido: sin registro no hay datos).
 */
export const RECORRIDO_EXPORTABLE = true;
export const ACCION_EXPORTAR_RECORRIDO = "hilo.exportar_pdf";

/**
 * Lo que la paciente puede pedir y la app efectivamente ejecuta. El texto sólo
 * ofrece estas acciones (decisión del dueño: no prometer lo que el sistema no
 * hace).
 *
 * - Ver sus notas aprobadas y el resumen del proceso: la nota se abre en
 *   /sesiones/[id] y el Recorrido en la ficha, también como PDF.
 * - Corregir sus datos de contacto: PATCH /api/pacientes/[id]
 *   (pacienteUpdateSchema: nombre, apellido, teléfono).
 * - Corregir el resumen del proceso: POST .../hilo/versiones agrega una
 *   versión; las anteriores no se borran (trigger de inmutabilidad).
 */
export const PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN = true;
export const PACIENTE_PUEDE_CORREGIR_CONTACTO = true;
export const PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES = true;

/**
 * Lo que NO se puede hacer desde la app, y por eso el texto no lo ofrece:
 * - Borrar datos: /api/pacientes/[id] no tiene DELETE (sólo se archiva), y la
 *   migración 20260916013000_inmutabilidad impide borrar versiones del
 *   Recorrido y eventos de auditoría.
 * - Corregir una nota aprobada: `aprobada` es terminal (sesion-clinica/estados).
 * - Ver la transcripción: ningún componente llama a su ruta de lectura.
 * - Ver esta autorización firmada: GET /api/pacientes/[id]/consentimiento no
 *   devuelve el texto ni la firma.
 */
export const BORRADO_DE_DATOS_A_PEDIDO = false;
export const NOTA_APROBADA_CORREGIBLE = false;
export const TRANSCRIPCION_VISIBLE_EN_PANTALLA = false;
export const CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA = false;

export const MARCO_LEGAL = {
  ley: "Ley 18.331 de Protección de Datos Personales (Uruguay)",
  transferenciaInternacional: true,
} as const;
