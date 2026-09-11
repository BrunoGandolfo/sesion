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
 * El borrado en AssemblyAI es un trabajo durable (borrar_transcript_asr):
 * se reintenta hasta que el proveedor confirma (200/404). Área 2 y 4.
 */
export const ASR_BORRADO_CON_REINTENTO = true;

/** Anthropic recibe la transcripción y el hilo vigente del paciente. */
export const LLM_RECIBE_CONTEXTO = true;

/** Workspace de Anthropic con retención deshabilitada. Verificado en la
 *  consola el 2026-09-04 (docs/operaciones.md §1). Renovar la fecha a mano. */
export const ANTHROPIC_RETENCION_CERO = true;
export const ANTHROPIC_RETENCION_VERIFICADA_EL = "2026-09-04";

/** El borrado del audio en R2 es un trabajo durable (borrar_audio_r2) y la
 *  clave se destruye en la transacción que aprueba la nota. Área 2. */
export const LIMPIEZA_AUDIO_REINTENTA = true;

/** Backups diarios de la base (.github/workflows/backup.yml), retención en días. */
export const RETENCION_BACKUPS_DIAS = 30;
/** El dump incluye la clave del audio (cifrada) de las sesiones no aprobadas. */
export const BACKUP_INCLUYE_CLAVE_AUDIO = true;

/** Revocar el consentimiento no borra lo ya guardado (DELETE solo revoca). */
export const REVOCAR_BORRA_HISTORIA = false;

/** Cada lectura de una nota queda registrada (eventos_auditoria). */
export const ACCION_VER_SESION = "sesion.ver";

export const MARCO_LEGAL = {
  ley: "Ley 18.331 de Protección de Datos Personales (Uruguay)",
  transferenciaInternacional: true,
} as const;
