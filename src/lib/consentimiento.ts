// Texto del consentimiento informado para grabar sesiones, versión 2.8.
//
// Se GENERA desde src/lib/consentimiento-hechos.ts: cada frase que afirma
// algo sobre el tratamiento de los datos sale de una constante que el código
// hace verdadera, y consentimiento.test.ts las ata. El historial de versiones
// anteriores (1.1 a 2.7) está en Git.
//
// La 2.7 (decisión del dueño) persigue dos cosas:
//
// - VERDAD. La app dejó de cifrar el audio el 18/9/2026 y la 2.6 seguía
//   diciendo que cada trozo se cifraba en el teléfono con una clave de la
//   sesión, que el servidor lo "descifraba" y que la clave se destruía al
//   aprobar. Nada de eso existe: el audio viaja por una conexión cifrada, el
//   almacén lo cifra en reposo y aprobar programa su borrado. La 2.6 también
//   decía que la transcripción no se podía ver, y hoy se ve.
// - BREVEDAD. Una pantalla y media de teléfono (tope en el test: 3.500
//   caracteres). Un párrafo corto por tema, de vos, sin jerga.
//
// La 2.8 corrige una sola frase: el borrado en AssemblyAI se reintenta aunque
// el programa que transcribe se corte a mitad de camino (el worker registra
// el id del transcript al crearlo, no al terminar). La 2.7 decía que el
// reintento existía sólo si la transcripción se completaba.
//
// Las firmas anteriores siguen vigentes para grabar; sugiereRefirmar pide la
// nueva.

import type { db } from "@/lib/db";

import {
  ALMACEN_CIFRA_EN_REPOSO,
  ANALISIS_DE_LA_PROFESIONAL_POR_IA,
  ANTHROPIC_RETENCION_CERO,
  ASR_BORRADO_CON_REINTENTO,
  ASR_BORRADO_DIAS_APROX,
  ASR_BORRADO_INMEDIATO,
  ASR_REINTENTO_AUNQUE_EL_PROCESO_MUERA,
  AUDIO_EN_ARCHIVO_DEL_SERVIDOR,
  AUDIO_SE_SUBE_AL_TERMINAR,
  AUDIO_VIAJA_POR_CONEXION_CIFRADA,
  BACKUP_INCLUYE_AUDIO,
  BORRADO_DE_DATOS_A_PEDIDO,
  BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR,
  CLAVE_AUDIO_DESTRUIDA_AL_APROBAR,
  CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA,
  COPIA_LOCAL_SE_CONSERVA_TRAS_SUBIR,
  LIMPIEZA_AUDIO_DIAS_APROX,
  LIMPIEZA_AUDIO_REINTENTA,
  LLM_RECIBE_CONTEXTO,
  LLM_RECIBE_NOTA_APROBADA,
  LUPITA_CONSULTA_AGENDA,
  LUPITA_HISTORIAL_A_ANTHROPIC,
  LUPITA_SOLO_LECTURA,
  MARCO_LEGAL,
  MEDIOS_CAPTURA,
  NOTA_APROBADA_CORREGIBLE,
  PACIENTE_PUEDE_CORREGIR_CONTACTO,
  PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES,
  PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN,
  PROVEEDORES,
  RECORRIDO_EXPORTABLE,
  RESPALDO_LOCAL_CIFRADO,
  RESUMEN_PROPUESTO_POR_IA,
  RETENCION_BACKUPS_DIAS,
  RETENCION_BACKUPS_MENSUALES_MESES,
  REVOCAR_BORRA_HISTORIA,
  TRANSCRIPCION_VISIBLE_EN_PANTALLA,
  VOCABULARIO_A_ASR,
  VOCABULARIO_INCLUYE_NOMBRES,
} from "@/lib/consentimiento-hechos";

export const CONSENTIMIENTO_VERSION = "2.8";
/** Fecha de la versión, tal como se lee al pie del texto. */
export const CONSENTIMIENTO_FECHA = "29 de septiembre de 2026";

/** ¿Conviene sugerirle a la profesional que la paciente firme el texto nuevo? */
export function sugiereRefirmar(textoVersion: string): boolean {
  return textoVersion !== CONSENTIMIENTO_VERSION;
}

/** Une con comas y una "y" (o la conjunción que se pida) antes del último. */
function enumerar(partes: readonly (string | null | false)[], conjuncion = "y"): string {
  const reales = partes.filter((p): p is string => Boolean(p));
  if (reales.length <= 1) return reales.join("");
  return `${reales.slice(0, -1).join(", ")} ${conjuncion} ${reales.at(-1)}`;
}

export function generarTextoConsentimiento(params: {
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}): string {
  const { nombrePaciente, nombreProfesional: prof, direccionConsultorio } = params;
  const { assemblyai, anthropic, r2, railway, neon } = PROVEEDORES;
  const soloAudio = MEDIOS_CAPTURA.length === 1 && MEDIOS_CAPTURA[0] === "audio";

  // ¿Qué se graba?
  const queSeGraba = `${soloAudio ? "Solo el audio, nunca video" : "La sesión"}, y solo si aceptás. Si no, la sesión sigue igual y ${prof} toma notas como siempre.`;

  // ¿A dónde va y quién lo procesa?
  const telefono = `El audio queda${RESPALDO_LOCAL_CIFRADO ? " cifrado" : ""} en el teléfono de ${prof} ${AUDIO_SE_SUBE_AL_TERMINAR ? "hasta que termina la sesión y se sube" : "y se va subiendo"}${AUDIO_VIAJA_POR_CONEXION_CIFRADA ? " por una conexión cifrada" : ""} a ${r2.nombre}, un almacenamiento${ALMACEN_CIFRA_EN_REPOSO ? " que lo guarda cifrado" : ""}${COPIA_LOCAL_SE_CONSERVA_TRAS_SUBIR ? "" : ", y se borra del teléfono"}.`;
  const asr = ` Un programa de esta aplicación en ${railway.nombre} lo manda, ${AUDIO_EN_ARCHIVO_DEL_SERVIDOR ? "desde un archivo temporal" : "sin guardarlo en otro archivo"}, a ${assemblyai.nombre}, que lo pasa a texto${VOCABULARIO_A_ASR ? ` con ayuda de una lista de palabras que ${prof} carga${VOCABULARIO_INCLUYE_NOMBRES ? " y que puede incluir tu nombre" : ""}` : ""}.`;
  const ia = ` ${anthropic.nombre} recibe ese texto${LLM_RECIBE_CONTEXTO ? " y el resumen de tu proceso" : ""}: ${enumerar([
    "redacta un borrador de la nota",
    ANALISIS_DE_LA_PROFESIONAL_POR_IA ? `prepara un análisis del trabajo de ${prof} que solo ella ve` : null,
    RESUMEN_PROPUESTO_POR_IA ? `propone cómo actualizar el resumen${LLM_RECIBE_NOTA_APROBADA ? " cuando ella aprueba la nota" : ""}` : null,
  ])}.`;
  const ley = MARCO_LEGAL.ley.split(" de ")[0];
  const exterior = MARCO_LEGAL.transferenciaInternacional
    ? ` ${assemblyai.nombre} y ${anthropic.nombre} están en ${assemblyai.pais === anthropic.pais ? anthropic.pais : `${assemblyai.pais} y ${anthropic.pais}`}: al firmar autorizás esa transferencia internacional (${ley}).`
    : "";

  // ¿Qué queda guardado y cómo?
  const guardado = `La transcripción, la nota y el resumen de tu proceso se guardan cifrados en la base de datos (${neon.nombre}), con esta autorización y tu firma.${BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR ? " Ella revisa, corrige y aprueba el borrador de la IA, que también queda guardado" : ""}${RESUMEN_PROPUESTO_POR_IA ? "; el resumen solo cambia si acepta la propuesta" : ""}.`;
  const borradoAudio = ` Al aprobar la nota, la aplicación ${CLAVE_AUDIO_DESTRUIDA_AL_APROBAR ? "destruye la clave del audio y " : ""}manda borrar el audio${LIMPIEZA_AUDIO_REINTENTA ? ` y reintenta unos ${LIMPIEZA_AUDIO_DIAS_APROX} días; si no lo logra, el borrado queda marcado como fallido` : ""}.`;
  const borradoAsr = ASR_BORRADO_INMEDIATO
    ? ` Al terminar la transcripción le pide a ${assemblyai.nombre} que borre el audio y el texto${ASR_BORRADO_CON_REINTENTO ? `, y repite el pedido unos ${ASR_BORRADO_DIAS_APROX} días${ASR_REINTENTO_AUNQUE_EL_PROCESO_MUERA ? " aunque este programa se corte a mitad de camino" : ""}` : ""}; no puede comprobar que se haya borrado.`
    : "";
  const retencion = ANTHROPIC_RETENCION_CERO
    ? ` ${anthropic.nombre} está configurada para no conservar el contenido ni usarlo para entrenar.`
    : "";

  // Copias de seguridad
  const respaldos = `Las diarias se guardan ${RETENCION_BACKUPS_DIAS} días y las mensuales hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses. Tienen lo mismo que la base, cifrado${BACKUP_INCLUYE_AUDIO ? ", con el audio" : ", sin el audio"}.`;

  // ¿Quién puede ver?
  const quien = `Solo ${prof}, desde su cuenta, y cada vez que abre tu nota${TRANSCRIPCION_VISIBLE_EN_PANTALLA ? " o tu transcripción" : ""} queda registrado. ${assemblyai.nombre} y ${anthropic.nombre} procesan en forma automática; dicen que nadie accede al contenido, pero la aplicación no puede verificarlo.${RECORRIDO_EXPORTABLE ? ` Si ella imprime o guarda como PDF el resumen de tu proceso, esa copia queda fuera de la aplicación, sin cifrar y bajo su cuidado, y queda registrado.` : ""}`;

  // Lupita
  const lupita = LUPITA_CONSULTA_AGENDA
    ? `\n\nLupita\nLa ayuda de la aplicación. Cuando ella le pregunta por la agenda, puede ver tu nombre y el día, la hora, la duración y la modalidad de tus turnos${LUPITA_HISTORIAL_A_ANTHROPIC ? `, y esa conversación pasa por ${anthropic.nombre}` : ""}. Nunca lee tus notas, tu transcripción ni tu resumen${LUPITA_SOLO_LECTURA ? ", y no cambia nada" : ""}.`
    : "";

  // ¿Qué podés pedir?
  const mostrar = PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN
    ? `que te muestre ${enumerar(["tus notas aprobadas", TRANSCRIPCION_VISIBLE_EN_PANTALLA ? "tu transcripción" : null, "el resumen de tu proceso"])}`
    : null;
  const corregir = PACIENTE_PUEDE_CORREGIR_CONTACTO || PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES
    ? `que corrija ${enumerar([PACIENTE_PUEDE_CORREGIR_CONTACTO ? "tus datos de contacto" : null, PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES ? "el resumen" : null], "o")}`
    : null;
  const noSePuede = enumerar([
    !BORRADO_DE_DATOS_A_PEDIDO ? "borrar tus datos" : null,
    !NOTA_APROBADA_CORREGIBLE ? "corregir una nota ya aprobada" : null,
    !CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA ? "ver esta autorización firmada" : null,
    !TRANSCRIPCION_VISIBLE_EN_PANTALLA ? "ver la transcripción" : null,
  ], "ni");
  const pedidos = `Podés pedirle a ${prof} ${[mostrar, corregir].filter(Boolean).join(", y ")}.${PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES ? " Corregir el resumen agrega una versión nueva: las anteriores se conservan." : ""}${noSePuede ? ` Desde la aplicación no se pueden ${noSePuede}.` : ""}`;

  // Revocar
  const revocar = `Podés revocar esta autorización cuando quieras, sin explicar por qué: alcanza con avisarle. Desde ese momento no se graba más. ${REVOCAR_BORRA_HISTORIA ? "Lo ya guardado se borra." : "Lo ya guardado no se borra: sigue siendo parte de tu historia clínica."} Tu tratamiento no cambia.`;

  return `Autorización para grabar tus sesiones

Hola ${nombrePaciente}. ${prof} te pide autorización para grabar tus sesiones en ${direccionConsultorio}. Leelo con calma: son tus datos de salud.

Qué se graba
${queSeGraba}

A dónde va y quién lo procesa
${telefono}${asr}${ia}${exterior}

Qué queda guardado
${guardado}${borradoAudio}${borradoAsr}${retencion}

Copias de seguridad
${respaldos}

Quién puede ver
${quien}${lupita}

Qué podés pedir
${pedidos}

Si cambiás de opinión
${revocar}

Al firmar, declaro que leí esta información y autorizo la grabación de mis sesiones y el tratamiento de mis datos aquí descriptos.

Versión ${CONSENTIMIENTO_VERSION}, ${CONSENTIMIENTO_FECHA}.
`;
}

export function esConsentimientoVigente(
  consentimiento: { firmadoEn: Date; revocadoEn: Date | null } | null,
): boolean {
  if (!consentimiento) return false;
  return consentimiento.revocadoEn === null;
}

// ────────────────────────────────────────────────────────────────────────────
// La búsqueda del consentimiento vigente, una sola vez y con la organización
// en la pregunta (ver el historial de esta función: estaba escrita tres veces
// y una sin organización).
// ────────────────────────────────────────────────────────────────────────────

const CONSENTIMIENTO_SELECT = {
  id: true,
  pacienteId: true,
  firmadoEn: true,
  textoVersion: true,
  revocadoEn: true,
} as const;

export interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: Date;
  textoVersion: string;
  revocadoEn: Date | null;
}

type ClienteConsentimientos = Pick<typeof db, "consentimientoGrabacion">;

export async function buscarConsentimientoVigente(
  prisma: ClienteConsentimientos,
  pacienteId: string,
  organizationId: string,
): Promise<ConsentimientoVigente | null> {
  const consentimiento = await prisma.consentimientoGrabacion.findFirst({
    where: { pacienteId, organizationId, revocadoEn: null },
    orderBy: { firmadoEn: "desc" },
    select: CONSENTIMIENTO_SELECT,
  });
  return esConsentimientoVigente(consentimiento) ? consentimiento : null;
}

export async function consentimientoVigenteDe(
  prisma: ClienteConsentimientos,
  pacienteId: string,
  organizationId: string,
): Promise<boolean> {
  return (await buscarConsentimientoVigente(prisma, pacienteId, organizationId)) !== null;
}
