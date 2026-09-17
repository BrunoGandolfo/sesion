// Texto del consentimiento informado para grabar sesiones, versión 2.4.
//
// Se GENERA desde src/lib/consentimiento-hechos.ts: cada frase que afirma
// algo sobre el tratamiento de los datos sale de una constante que el código
// hace verdadera, y consentimiento.test.ts las ata. Lo que la 1.1 decía mal
// (que no viajaban nombres, que AssemblyAI "borra de sus servidores" sin
// comprobarlo, que "cualquier copia sería imposible de abrir") acá se dice
// como es.
//
// La 2.1 agrega que la profesional puede imprimir o guardar como archivo el
// resumen del proceso para su propio archivo (RECORRIDO_EXPORTABLE). Una
// firma anterior no cubre esa salida: hay que volver a firmar.
//
// La 2.2 corrige retención, reintentos, propuesta de la IA y archivo temporal,
// e incluye el párrafo de exportación de la 2.1.
//
// La 2.3 cuenta el borrado en AssemblyAI como ocurre (un pedido inmediato y
// reintentos acotados sólo si la transcripción se completó), la copia cifrada
// que queda en el teléfono y que el borrador de la IA se guarda antes de
// aprobar.
//
// La 2.4 deja de prometer lo que la app no ejecuta (decisión del dueño): en
// lugar de "derecho a acceder, corregir y eliminar", dice qué puede pedir la
// paciente que la app sí hace y qué no se puede hacer desde la app. Las firmas
// anteriores necesitan refirma. La vigencia técnica no se cambia en esta tanda: la API
// devuelve sugiereRefirmar y la profesional debe pedir la nueva firma.

import type { db } from "@/lib/db";

import {
  ANTHROPIC_RETENCION_CERO,
  ASR_BORRADO_CON_REINTENTO,
  ASR_BORRADO_DIAS_APROX,
  ASR_BORRADO_INMEDIATO,
  ASR_REINTENTO_SOLO_SI_SE_COMPLETO,
  AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL,
  BACKUP_INCLUYE_CLAVE_AUDIO,
  BORRADO_DE_DATOS_A_PEDIDO,
  BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR,
  CLAVE_AUDIO_DESTRUIDA_AL_APROBAR,
  CLAVE_POR_SESION,
  CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA,
  COPIA_LOCAL_CIFRADA_SE_CONSERVA,
  LIMPIEZA_AUDIO_DIAS_APROX,
  LIMPIEZA_AUDIO_REINTENTA,
  LLM_RECIBE_CONTEXTO,
  LLM_RECIBE_NOTA_APROBADA,
  MARCO_LEGAL,
  MEDIOS_CAPTURA,
  NOTA_APROBADA_CORREGIBLE,
  PACIENTE_PUEDE_CORREGIR_CONTACTO,
  PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES,
  PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN,
  PROVEEDORES,
  RESPALDO_LOCAL_CIFRADO,
  RECORRIDO_EXPORTABLE,
  RESUMEN_PROPUESTO_POR_IA,
  RETENCION_BACKUPS_DIAS,
  RETENCION_BACKUPS_MENSUALES_MESES,
  REVOCAR_BORRA_HISTORIA,
  TRANSCRIPCION_VISIBLE_EN_PANTALLA,
  VOCABULARIO_A_ASR,
  VOCABULARIO_INCLUYE_NOMBRES,
  VOCABULARIO_SOLO_A_ASR,
} from "@/lib/consentimiento-hechos";

export const CONSENTIMIENTO_VERSION = "2.4";

/** ¿Conviene sugerirle a la profesional que la paciente firme el texto nuevo? */
export function sugiereRefirmar(textoVersion: string): boolean {
  return textoVersion !== CONSENTIMIENTO_VERSION;
}

export function generarTextoConsentimiento(params: {
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}): string {
  const { nombrePaciente, nombreProfesional, direccionConsultorio } = params;
  const { assemblyai, anthropic, r2, railway, neon } = PROVEEDORES;

  const soloAudio = MEDIOS_CAPTURA.length === 1 && MEDIOS_CAPTURA[0] === "audio";

  const respaldoLocal = RESPALDO_LOCAL_CIFRADO
    ? `1. Mientras se graba, el audio se cifra en el teléfono de ${nombreProfesional}, por tramos, ${CLAVE_POR_SESION ? "con una clave que se crea para esa sesión" : "con la clave de la aplicación"}, y se va subiendo ya cifrado. En el teléfono no queda audio sin cifrar.`
    : `1. Mientras se graba, el audio queda en el teléfono de ${nombreProfesional}. En esa etapa todavía no está cifrado. Al terminar se cifra en el teléfono, antes de salir, ${CLAVE_POR_SESION ? "con una clave que se crea para esa sesión" : "con la clave de la aplicación"}.`;

  const vocabulario = VOCABULARIO_A_ASR
    ? VOCABULARIO_INCLUYE_NOMBRES
      ? ` Recibe además una lista de palabras que ${nombreProfesional} carga para que se escriban bien: términos clínicos y nombres propios, que pueden incluir el tuyo y el de personas que nombrás en las sesiones.`
      : ` Recibe además una lista de términos clínicos que ${nombreProfesional} carga para que se escriban bien; esa lista no incluye nombres de personas.`
    : "";

  const borradoAsr = ASR_BORRADO_INMEDIATO && ASR_BORRADO_CON_REINTENTO && ASR_REINTENTO_SOLO_SI_SE_COMPLETO
    ? ` Apenas termina, bien o mal, la aplicación le pide que borre el audio y el texto. Si la transcripción se completó, además repite ese pedido durante unos ${ASR_BORRADO_DIAS_APROX} días, hasta que el servicio responde que lo borró o que ya no existe; si aun así no lo logra, el borrado queda marcado como fallido. Si la transcripción falla, o el programa se interrumpe o no logra dejar anotado el reintento, ese pedido se hace una sola vez o no llega a hacerse, y esta aplicación no puede comprobar que el servicio lo haya borrado.`
    : " Cuando termina, la aplicación le pide que borre el audio y el texto; esta aplicación no puede comprobar si lo hizo.";

  const contexto = (LLM_RECIBE_CONTEXTO
    ? "recibe el texto de la sesión y el resumen de tu proceso hasta ese día, y redacta el borrador de la nota"
    : "recibe el texto de la sesión y redacta el borrador de la nota")
    + (LLM_RECIBE_NOTA_APROBADA
      ? `. Cuando ${nombreProfesional} aprueba la nota, recibe esa nota, con sus correcciones, y el resumen vigente, para proponer cómo actualizarlo`
      : "");

  const retencion = ANTHROPIC_RETENCION_CERO
    ? ` La cuenta que usa esta aplicación está configurada para que ${anthropic.nombre} no conserve ese contenido ni lo use para entrenar sus sistemas.`
    : "";

  const clave = CLAVE_AUDIO_DESTRUIDA_AL_APROBAR
    ? "En ese momento la aplicación destruye siempre la clave del audio en la base que usa para trabajar. Desde entonces no puede abrir ese archivo, aunque siga pendiente de borrado. "
    : "";
  const limpieza = clave + (LIMPIEZA_AUDIO_REINTENTA
    ? `La aplicación intenta borrar el archivo. Si no lo logra, repite los intentos durante unos ${LIMPIEZA_AUDIO_DIAS_APROX} días; después el borrado queda marcado como fallido.`
    : "La aplicación intenta borrar el archivo.");

  const plazos = `Las copias de respaldo de la base de datos se guardan ${RETENCION_BACKUPS_DIAS} días si son diarias y hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses si son mensuales.`;
  const copiaLocal = COPIA_LOCAL_CIFRADA_SE_CONSERVA
    ? ` En el teléfono de ${nombreProfesional} queda una copia cifrada de la grabación: la aplicación no la borra, y desde la aprobación ya no puede abrirla.`
    : "";
  const backups = BACKUP_INCLUYE_CLAVE_AUDIO
    ? ` ${plazos} No contienen el audio, pero sí pueden contener, cifrada, la clave de un audio que todavía no se había borrado. Esa clave puede conservarse hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses, aunque ya se haya eliminado de la base que usa la aplicación. Si el archivo no se pudo borrar, esa copia de la clave podría permitir abrirlo${COPIA_LOCAL_CIFRADA_SE_CONSERVA ? ", y lo mismo vale para la copia cifrada del teléfono" : ""}.`
    : ` ${plazos} No contienen el audio ni su clave.`;

  const nota = BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR
    ? `el registro escrito que ${nombreProfesional} guarda en tu historia clínica. Primero la inteligencia artificial escribe un borrador, que queda guardado, cifrado; ${nombreProfesional} lo revisa, lo corrige y lo aprueba antes de que forme parte de tu historia clínica.`
    : `el registro escrito que ${nombreProfesional} guarda en tu historia clínica y que ella revisa y aprueba antes de que quede guardado.`;

  const resumen = RESUMEN_PROPUESTO_POR_IA
    ? `También para preparar, a partir de varias sesiones, un resumen de tu proceso. Lo propone la misma inteligencia artificial que redacta la nota; ${nombreProfesional} lo revisa, lo corrige o lo descarta. Solo queda vigente cuando ella lo acepta. La decisión sigue siendo suya.`
    : "También para preparar, a partir de varias sesiones, un resumen de tu proceso que solo ella ve y edita.";

  const descifrado = AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL
    ? "lo descifra en un archivo temporal del servidor y lo manda a transcribir. Ese archivo temporal se borra al terminar"
    : "lo descifra solo en memoria y lo manda a transcribir";

  const exportacion = RECORRIDO_EXPORTABLE
    ? `\n\n${nombreProfesional} puede imprimir el resumen de tu proceso, o guardarlo como archivo en su teléfono o su computadora, para su propio archivo profesional. Esa copia ya no está dentro de la aplicación ni cifrada: queda bajo su cuidado, como cualquier registro de tu historia clínica en papel. La preparación de esa copia queda registrada por la aplicación.`
    : "";

  const pedidos = [
    PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN ? "que te muestre tus notas clínicas aprobadas y el resumen de tu proceso" : null,
    PACIENTE_PUEDE_CORREGIR_CONTACTO || PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES
      ? `que corrija ${[PACIENTE_PUEDE_CORREGIR_CONTACTO ? "tus datos de contacto" : null, PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES ? "el resumen de tu proceso" : null].filter(Boolean).join(" o ")}`
      : null,
  ].filter(Boolean);
  const noSePuede = [
    !BORRADO_DE_DATOS_A_PEDIDO ? "borrar tus datos" : null,
    !NOTA_APROBADA_CORREGIBLE ? "corregir las notas ya aprobadas" : null,
    !TRANSCRIPCION_VISIBLE_EN_PANTALLA || !CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA
      ? `ver ${[!TRANSCRIPCION_VISIBLE_EN_PANTALLA ? "la transcripción" : null, !CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA ? "esta autorización firmada" : null].filter(Boolean).join(" ni ")}`
      : null,
  ].filter(Boolean);
  const queSePuedePedir = `\n\n¿Qué podés pedir?\nPodés pedirle a ${nombreProfesional} ${pedidos.join(", y ")}.${PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES ? " Corregir el resumen agrega una versión nueva: las anteriores se conservan." : ""}${noSePuede.length ? ` Desde la aplicación no se puede ${noSePuede.join(", ni ")}.` : ""}`;

  const revocar = REVOCAR_BORRA_HISTORIA
    ? "Lo ya guardado se elimina de tu historia clínica."
    : "Lo ya guardado sigue formando parte de tu historia clínica.";

  return `Consentimiento informado para grabación de sesiones
Versión ${CONSENTIMIENTO_VERSION}

Hola ${nombrePaciente}.

Antes de empezar queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Tomate el tiempo de leerlo: se trata de tus datos y de tu intimidad.

¿Qué se graba?
El audio de tu sesión de psicoterapia con ${nombreProfesional}, en el consultorio ubicado en ${direccionConsultorio}.${soloAudio ? " No se graba video." : ""}

¿Para qué?
Para escribir, con ayuda de inteligencia artificial, la nota clínica de la sesión: ${nota} ${resumen} También se prepara un análisis de su propio trabajo que solo ella ve.

¿Por dónde pasa el audio?
${respaldoLocal}
2. Ya cifrado, se guarda en un servicio de almacenamiento (${r2.nombre}) y de ahí lo toma un programa de esta aplicación que corre en un servidor (${railway.nombre}), ${descifrado}.
3. ${assemblyai.nombre}, una empresa de ${assemblyai.pais}, convierte el audio en texto. Recibe el audio sin cifrar.${vocabulario}${borradoAsr}
4. ${anthropic.nombre}, otra empresa de ${anthropic.pais}, ${contexto}.${retencion}

No se les envía tu teléfono ni tu documento. Lo que sí reciben es lo que se dice en la sesión${VOCABULARIO_A_ASR ? (VOCABULARIO_SOLO_A_ASR ? `; además, ${assemblyai.nombre} recibe las palabras de la lista` : " y las palabras de la lista") : ""}${LLM_RECIBE_CONTEXTO || LLM_RECIBE_NOTA_APROBADA ? `, y ${anthropic.nombre}, el resumen de tu proceso y la nota aprobada` : ""}.

¿Quién puede escuchar o leer?
${nombreProfesional}, desde su cuenta. Nadie más de su consultorio. ${assemblyai.nombre} y ${anthropic.nombre} procesan de forma automática; sus condiciones dicen que ninguna persona accede al contenido, pero eso depende de ellos y esta aplicación no puede verificarlo.

¿Cuánto tiempo queda el audio?
Hasta que ${nombreProfesional} revisa y aprueba la nota, en general el mismo día. ${limpieza}${copiaLocal}${backups}

¿Qué queda guardado?
En la base de datos de la aplicación (${neon.nombre}), cifrado, y accesible solo para ${nombreProfesional}:
- La nota clínica, como parte de tu historia clínica.
- La transcripción de la sesión.
- El resumen de tu proceso que ella mantiene.
- Este consentimiento y tu firma.
El borrado del audio sigue los pasos y plazos explicados arriba.${exportacion}${queSePuedePedir}

¿Podés cambiar de opinión?
Sí, en cualquier momento y sin dar explicaciones. Alcanza con avisarle a ${nombreProfesional}. A partir de ese momento no se graban más sesiones. ${revocar} Esto no afecta tu tratamiento ni tu relación con ella.

¿Es obligatorio aceptar?
No. Si preferís que no se grabe, la sesión sigue igual y ${nombreProfesional} toma notas como siempre.

Marco legal
${MARCO_LEGAL.ley}: el tratamiento de datos de salud exige tu consentimiento previo, libre, expreso e informado.${MARCO_LEGAL.transferenciaInternacional ? " Parte del procesamiento ocurre fuera del país; esta autorización incluye esa transferencia internacional." : ""}

Al firmar, declaro que:
- Leí y entendí esta información.
- Autorizo la grabación de mis sesiones con ${nombreProfesional}.
- Entiendo que el audio${VOCABULARIO_A_ASR ? ", la lista de palabras" : ""} y el texto de la sesión se procesan en los servicios del exterior mencionados.
- Sé que puedo revocar esta autorización cuando quiera.
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
