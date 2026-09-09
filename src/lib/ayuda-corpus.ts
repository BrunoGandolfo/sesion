// El corpus del asistente de ayuda y el system prompt que lo envuelve.
//
// QUÉ ES
//
// Mariana pregunta "¿cómo hago para…?" o "¿por qué la app hace…?" y recibe
// una respuesta corta. La única fuente son los documentos de docs/ayuda/: no
// hay base vectorial ni búsqueda: entran los 16 archivos enteros —67 KB, unos
// 20 mil tokens— en el system prompt, y el prompt caching de Anthropic hace
// que ese bloque se pague completo una vez y después se lea al 10 %.
//
// Por eso el prompt tiene que ser BYTE A BYTE IDÉNTICO entre pedidos: el
// caché es un prefijo, y cualquier cambio —una fecha, un nombre de usuaria,
// el orden de los archivos— lo invalida entero. De ahí las tres decisiones
// de este archivo: la lista de archivos es explícita y ordenada (no un
// readdir, que depende del sistema de archivos), el prompt no lleva nada
// variable adentro, y el resultado se memoiza por instancia.
//
// SIN ACCESO A DATOS
//
// El asistente no ve pacientes, turnos ni montos: solo el corpus. Eso no es
// una limitación técnica que haya que levantar después, es la decisión de
// diseño — ver LIMITES_ASISTENTE, punto 2.
//
// RUNTIME NODEJS
//
// Lee del disco con node:fs. Este módulo NO es alcanzable desde
// src/middleware.ts (regla 9 de AGENTS.md): lo importa solamente el caso de
// uso de /api/ayuda, que declara runtime nodejs.
//
// OJO CON EL DEPLOY: Next traza los imports, no las lecturas de disco, así
// que docs/ayuda/ no entra solo en el bundle de la función. Por eso
// next.config.ts declara:
//
//   outputFileTracingIncludes: { "/api/ayuda": ["./docs/ayuda/**"] }
//
// Si esa línea se cae, en local no se nota y en Vercel /api/ayuda contesta
// ERROR_CORPUS_AUSENTE. Y si algún día el corpus lo usa otra ruta, esa ruta
// necesita su propia entrada: la clave es la ruta, no el módulo.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LUPITA } from "@/lib/glosario";

/** Cómo se llama el asistente cuando habla de sí mismo. El nombre sale del
 *  glosario, que es el mismo que usa el panel de ayuda: si acá dijera una
 *  cosa y la pantalla otra, la usuaria estaría hablando con dos personajes.
 *  Ojo: cambiarlo invalida el prefijo cacheado del prompt una vez. */
export const NOMBRE_ASISTENTE = LUPITA;

/** Directorio del corpus, relativo a la raíz del proyecto. */
export const DIRECTORIO_CORPUS = join("docs", "ayuda");

/**
 * Los documentos, en el orden del índice. Explícito y no un readdir: el
 * orden es parte del prefijo cacheado, y el que devuelve el sistema de
 * archivos no está garantizado. Un documento nuevo en docs/ayuda/ se agrega
 * acá o el asistente no lo ve — el test de corpus falla si la lista y el
 * directorio no coinciden.
 */
export const ARCHIVOS_CORPUS = [
  "_indice.md",
  "00-que-es-sesion.md",
  "01-entrar-y-cuenta.md",
  "02-pantalla-hoy.md",
  "03-agenda-y-turnos.md",
  "04-pacientes-y-ficha.md",
  "05-cobros.md",
  "06-recordatorios-sms.md",
  "07-grabar-una-sesion.md",
  "08-la-nota-clinica.md",
  "09-para-vos-feedback.md",
  "10-el-hilo-y-el-recorrido.md",
  "11-tu-consultorio.md",
  "12-camino-del-audio-y-privacidad.md",
  "13-preguntas-frecuentes.md",
  "14-cuando-algo-falla.md",
] as const;

/**
 * Los cinco límites del asistente, tal como van al system prompt.
 *
 * Se exportan para que el test los verifique uno por uno: son la parte del
 * prompt que no se puede perder en una edición distraída, y un test que
 * busca el texto exacto es más difícil de romper sin darse cuenta que un
 * comentario que pide no tocarlo.
 */
export const LIMITES_ASISTENTE: readonly string[] = [
  "1. Respondés solamente sobre cómo se usa Sesión y por qué la app hace lo que hace. Si algo no está en los documentos de más abajo, decilo con todas las letras y sugerí el documento más cercano. No inventes funciones, botones ni pantallas que no aparezcan en el corpus.",
  "2. Nunca opinás sobre una paciente, sobre una nota clínica ni sobre una señal de riesgo concreta. Esa lectura es de la profesional, no tuya. Podés explicar cómo funciona la señal de riesgo; no podés interpretar una.",
  "3. Sos cálida y cómplice, como una colega que conoce la app y sabe que Mariana está entre paciente y paciente. Escribís en rioplatense, de vos, con frases cortas y humor suave cuando venga bien. Respondés entre 3 y 8 líneas. Solo texto plano: nada de Markdown, asteriscos, títulos ni tablas. Separás párrafos con saltos de línea. Empezá cada respuesta con una frase corta y humana, como si contestaras por WhatsApp a una colega; nada de encabezados ni listas salvo pasos numerados. Los nombres de botones y pantallas van con el texto exacto que muestra la app, entre comillas.",
  "4. No das consejo clínico, legal ni médico.",
  "5. Si la usuaria describe una situación de riesgo, propia o de una paciente, respondés una sola línea que la remita a los servicios de emergencia y a su supervisión clínica. Nada más: ni pasos, ni preguntas, ni ofrecimiento de seguir hablando del tema.",
];

/** Encabezado del prompt: quién es y para quién trabaja. */
const IDENTIDAD = [
  `Sos ${NOMBRE_ASISTENTE}, el asistente de ayuda que vive adentro de Sesión, la app de consultorio de una psicóloga que trabaja sola en Montevideo.`,
  "Ella no es técnica: no le expliques con vocabulario de programación, no le hables de la base de datos ni de la API. Hablale de lo que ve en la pantalla.",
  "Tu única fuente son los documentos que están abajo, entre las marcas CORPUS. No tenés acceso a sus pacientes, sus turnos ni sus montos: no los ves y no los podés mirar. Si te preguntan algo que necesitaría ese acceso, decí que no ves esos datos y explicá en qué pantalla los ve ella.",
].join("\n");

const EJEMPLOS_DE_VOZ = [
  "Ejemplos buenos:",
  'Pregunta: ¿Dónde cambio la tarifa?\nRespuesta: Andá a "Tu consultorio" y buscá "Lo que cobrás".\nCambiás la tarifa y listo: se guarda sola.\nOjo chiquito: los pacientes y turnos que ya cargaste conservan la tarifa que tenían.',
  'Pregunta: ¿Cómo mando un recordatorio?\nRespuesta: Eso camina solo. Cuando agendás un turno, Sesión programa el SMS según lo que elegiste en "Tu consultorio".\nSi querés cambiar el momento o el texto, entrá ahí y bajá hasta "Recordatorio".',
  'Pregunta: ¿Qué pasa si se corta la grabación?\nRespuesta: Tranquila: lo grabado queda a salvo.\nPodés tocar "Reanudar" para seguir en el mismo archivo, o "Terminar la sesión" para guardar lo que hay.\nLa llamada se llevó el micrófono, no la sesión.',
  "Ejemplos malos (nunca respondas así):",
  'Malo: **Configuración de tarifa**\n1. Navegue al módulo de configuración.\n2. Modifique el campo correspondiente.',
  "Malo: Por lo que contás, tu paciente parece estar evitando el tratamiento. Te recomiendo explorar esa resistencia.",
].join("\n\n");

/** Título de la sección de límites. */
const TITULO_LIMITES = "Tus límites, que no se negocian:";

const MARCA_INICIO_CORPUS = "===== CORPUS: documentación de Sesión =====";
const MARCA_FIN_CORPUS = "===== FIN DEL CORPUS =====";

/**
 * Saca los comentarios HTML del markdown. En docs/ayuda/ cada documento
 * cierra con un bloque `<!-- fuentes: … -->` que apunta a los archivos de
 * código de los que se escribió: le sirve a quien mantiene los documentos y
 * al asistente no, y son rutas de código —justo el vocabulario que el punto
 * de identidad le pide no usar.
 *
 * `[\s\S]` en vez de la bandera `s` para que funcione igual con comentarios
 * de varias líneas; el `?` lo hace no codicioso, así dos comentarios en un
 * mismo archivo no se comen el texto del medio.
 */
export function quitarComentariosHtml(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

/** Error de carga del corpus: es un problema de deploy, no de la usuaria. */
export class ErrorCorpus extends Error {
  constructor(archivo: string, causa: unknown) {
    super(`ERROR_CORPUS_AUSENTE: no se pudo leer ${archivo}`);
    this.name = "ErrorCorpus";
    this.cause = causa;
  }
}

let corpusCache: string | null = null;
let promptCache: string | null = null;

/**
 * El corpus concatenado, en el orden de ARCHIVOS_CORPUS, sin comentarios
 * HTML. Se lee del disco una sola vez por instancia de la función: la
 * segunda llamada devuelve lo mismo sin tocar el disco.
 *
 * `raiz` existe para el test, que corre desde la raíz del repo igual que la
 * función pero no tiene por qué depender de eso.
 */
export function leerCorpus(raiz: string = process.cwd()): string {
  if (corpusCache !== null) return corpusCache;

  const partes = ARCHIVOS_CORPUS.map((archivo) => {
    const ruta = join(raiz, DIRECTORIO_CORPUS, archivo);
    let contenido: string;
    try {
      contenido = readFileSync(ruta, "utf8");
    } catch (error) {
      throw new ErrorCorpus(join(DIRECTORIO_CORPUS, archivo), error);
    }
    // El nombre del archivo va como encabezado para que el asistente pueda
    // decir "está en 07-grabar-una-sesion.md" cuando remite a un documento.
    return `----- ${archivo} -----\n\n${quitarComentariosHtml(contenido).trim()}`;
  });

  corpusCache = partes.join("\n\n");
  return corpusCache;
}

/**
 * El system prompt completo: identidad, límites, corpus y voz al final, sin
 * una sola parte variable. Memoizado por la misma razón que leerCorpus.
 */
export function systemPromptAyuda(raiz?: string): string {
  if (promptCache !== null) return promptCache;

  promptCache = [
    IDENTIDAD,
    "",
    TITULO_LIMITES,
    ...LIMITES_ASISTENTE.filter((_, indice) => indice !== 2),
    "",
    MARCA_INICIO_CORPUS,
    "",
    leerCorpus(raiz),
    "",
    MARCA_FIN_CORPUS,
    "",
    EJEMPLOS_DE_VOZ,
    "",
    LIMITES_ASISTENTE[2],
  ].join("\n");

  return promptCache;
}

/** Vacía la memoria. Solo para los tests: en producción nunca hace falta. */
export function olvidarCorpus(): void {
  corpusCache = null;
  promptCache = null;
}
