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
 * El audio se cifra EN EL TELÉFONO, por segmentos, mientras se graba
 * (esquema: audio_segmentos.iv, clave por sesión). Área 1 lo implementa;
 * si en algún momento el respaldo local quedara sin cifrar, esto pasa a
 * false y el texto deja de prometerlo.
 */
export const RESPALDO_LOCAL_CIFRADO = true;

/** Una clave AES distinta por sesión (sesiones_clinicas.audio_clave_encrypted). */
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

/** clinical_analyzer.py usa el mismo proveedor/modelo para la nota y el
 * resumen. hilo/trabajo.ts sólo crea una propuesta; hilo/escribir.ts exige
 * la decisión de la profesional para hacerla vigente o rechazarla. */
export const RESUMEN_PROPUESTO_POR_IA = true;

/** audio_entrada.py: armar_audio usa TemporaryDirectory, escribe el audio
 * descifrado y elimina el directorio al salir, también ante excepciones. */
export const AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL = true;

/** sesion/resultado.ts guarda la nota de la IA (notaIa), cifrada, apenas
 * llega: antes de que la profesional la apruebe. Al aprobar se guarda aparte
 * la nota final y el borrador se conserva (se ve como "borrador original"). */
export const BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR = true;

/** audio/almacen.ts no tiene ninguna operación que borre segmentos o
 * grabaciones cifradas del navegador: sólo retirarCopiasViejas, que borra la
 * base vieja sin cifrar. La copia cifrada del teléfono se conserva. */
export const COPIA_LOCAL_CIFRADA_SE_CONSERVA = true;

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

export const MARCO_LEGAL = {
  ley: "Ley 18.331 de Protección de Datos Personales (Uruguay)",
  transferenciaInternacional: true,
} as const;
