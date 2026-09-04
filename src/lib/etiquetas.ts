// Etiquetas legibles para las claves crudas del modelo.
//
// El pipeline persiste claves de máquina: "senalamiento", "pregunta_circular",
// "ideacionSuicida", y temas en minúscula y sin tildes ("limites del encuadre
// terapeutico"). Hasta ahora cada pantalla las mostraba a su manera: el
// gráfico de intervenciones tenía su propio mapa de cuatro entradas y todo lo
// demás caía en "Otros"; el hilo mostraba el tema crudo con un `capitalize`
// de CSS, que da "Limites Del Encuadre Terapeutico". Acá se resuelve una vez.
//
// Tres capas, en este orden:
//   1. DICCIONARIO — intervenciones y flags de riesgo, con su nombre técnico
//      y sus tildes. Es la única fuente de esos nombres en la UI.
//   2. ACENTOS — léxico de palabra a palabra para el texto libre (temas), que
//      el modelo escribe sin tildes. Solo palabras donde la forma sin tilde no
//      es otra palabra válida del castellano: "practica", "critica" o
//      "termino" NO están, porque acentuarlas cambiaría el sentido.
//   3. Regla genérica — guiones bajos a espacio, camelCase separado, primera
//      mayúscula.
//
// Lo que NO hace: traducir, resumir ni reagrupar. "Señalamiento" se muestra
// "Señalamiento", no "Marcar algo". El vocabulario técnico queda intacto.

/** Quita los diacríticos combinantes (U+0300–U+036F) que NFD separa. */
function sinTildes(texto: string): string {
  return Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
}

/** "ideacionSuicida" → "ideacion Suicida". Separa camelCase para que las
 *  claves del contrato de riesgo se lean como frase. */
function separarCamelCase(texto: string): string {
  return texto.replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, "$1 $2");
}

/** Forma visible antes de acentuar y capitalizar: guiones bajos a espacio,
 *  camelCase separado, espacios colapsados. Conserva mayúsculas y tildes. */
function aFrase(clave: string): string {
  return separarCamelCase(clave).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Clave de búsqueda: la frase en minúscula y sin tildes. Hace que
 *  "pregunta_circular", "Pregunta Circular" y "pregunta circular" caigan en
 *  la misma entrada. */
function canonica(clave: string): string {
  return sinTildes(aFrase(clave)).toLowerCase();
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Diccionario explícito — intervenciones y flags
// ────────────────────────────────────────────────────────────────────────────

/**
 * Claves en forma canónica (minúscula, sin tildes, con espacios). Los ocho
 * tipos de intervención son los del contrato
 * (src/lib/sesion-clinica/schema.ts, tipoIntervencionSchema) y los cinco
 * flags son los de flagRiesgoSchema. Los nombres son los técnicos: no se
 * reemplazan por sinónimos coloquiales.
 */
const DICCIONARIO: Readonly<Record<string, string>> = {
  // Intervenciones
  reformulacion: "Reformulación",
  senalamiento: "Señalamiento",
  confrontacion: "Confrontación",
  interpretacion: "Interpretación",
  "pregunta circular": "Pregunta circular",
  validacion: "Validación",
  "silencio terapeutico": "Silencio terapéutico",
  otra: "Otra",
  otras: "Otras",
  otros: "Otros",

  // Flags de riesgo clínico
  "ideacion suicida": "Ideación suicida",
  autolesion: "Autolesión",
  "violencia terceros": "Violencia hacia terceros",
  "violencia a terceros": "Violencia hacia terceros",
  "violencia hacia terceros": "Violencia hacia terceros",
  "sintomas psicoticos": "Síntomas psicóticos",
  "crisis panico": "Crisis de pánico",
  "crisis de panico": "Crisis de pánico",

  // Niveles de la señal graduada
  ninguno: "Ninguno",
  bajo: "Bajo",
  moderado: "Moderado",
  alto: "Alto",

  // Alianza terapéutica
  fragil: "Frágil",
  inestable: "Inestable",
  estable: "Estable",
  fuerte: "Fuerte",
};

// ────────────────────────────────────────────────────────────────────────────
// 2. Léxico de acentos para texto libre (temas)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Palabra sin tildes → palabra acentuada. Se aplica palabra por palabra al
 * texto que no está en el DICCIONARIO, que es como llegan los temas.
 *
 * Criterio de admisión: la forma sin tilde no puede ser otra palabra válida.
 * Por eso no están "practica" (practica/práctica), "critica", "termino",
 * "publico", "esta", "papa": acentuarlas sería inventar sentido.
 */
const ACENTOS: Readonly<Record<string, string>> = {
  limite: "límite",
  limites: "límites",
  limitrofe: "limítrofe",
  terapeutico: "terapéutico",
  terapeutica: "terapéutica",
  terapeuticos: "terapéuticos",
  terapeuticas: "terapéuticas",
  panico: "pánico",
  depresion: "depresión",
  depresivo: "depresivo",
  ansiedad: "ansiedad",
  relacion: "relación",
  comunicacion: "comunicación",
  regulacion: "regulación",
  emocion: "emoción",
  sesion: "sesión",
  vinculo: "vínculo",
  vinculos: "vínculos",
  sintoma: "síntoma",
  sintomas: "síntomas",
  psicotico: "psicótico",
  psicoticos: "psicóticos",
  psicotica: "psicótica",
  psicoticas: "psicóticas",
  diagnostico: "diagnóstico",
  diagnostica: "diagnóstica",
  hipotesis: "hipótesis",
  analisis: "análisis",
  interpretacion: "interpretación",
  confrontacion: "confrontación",
  validacion: "validación",
  reformulacion: "reformulación",
  senalamiento: "señalamiento",
  autolesion: "autolesión",
  ideacion: "ideación",
  somatico: "somático",
  somaticos: "somáticos",
  somatica: "somática",
  somatizacion: "somatización",
  traumatico: "traumático",
  traumatica: "traumática",
  cronico: "crónico",
  cronica: "crónica",
  academico: "académico",
  academica: "académica",
  economico: "económico",
  economica: "económica",
  fisico: "físico",
  fisica: "física",
  adiccion: "adicción",
  alimentacion: "alimentación",
  medicacion: "medicación",
  separacion: "separación",
  migracion: "migración",
  obsesion: "obsesión",
  compulsion: "compulsión",
  disociacion: "disociación",
  expresion: "expresión",
  agresion: "agresión",
  frustracion: "frustración",
  proyeccion: "proyección",
  introyeccion: "introyección",
  estres: "estrés",
  tecnica: "técnica",
  tecnicas: "técnicas",
  aleman: "alemán",
};

/** Primera letra en mayúscula; el resto se deja como está (no se toca
 *  "TCA", "TOC" ni un nombre propio en medio de la frase). */
function capitalizar(texto: string): string {
  if (texto.length === 0) return texto;
  return texto[0].toLocaleUpperCase("es") + texto.slice(1);
}

function acentuarPalabra(palabra: string): string {
  const acentuada = ACENTOS[sinTildes(palabra).toLocaleLowerCase("es")];
  if (!acentuada) return palabra;
  // Si la palabra venía ya acentuada, `acentuada` es la misma forma: no hay
  // cambio. Si venía en mayúsculas se respeta la inicial.
  return palabra[0] === palabra[0].toLocaleUpperCase("es") &&
    palabra !== palabra.toLocaleUpperCase("es")
    ? capitalizar(acentuada)
    : acentuada;
}

/**
 * Clave cruda del modelo → texto legible.
 *
 *   formatearEtiqueta("senalamiento")   === "Señalamiento"
 *   formatearEtiqueta("pregunta_circular") === "Pregunta circular"
 *   formatearEtiqueta("ideacionSuicida")   === "Ideación suicida"
 *   formatearEtiqueta("limites del encuadre terapeutico")
 *     === "Límites del encuadre terapéutico"
 *
 * Una clave vacía o solo espacios devuelve "" — el llamador decide si en ese
 * caso no dibuja la fila. Nunca devuelve un texto inventado: si la clave no
 * está en el diccionario, se muestra la misma clave, legible.
 */
export function formatearEtiqueta(clave: string): string {
  if (typeof clave !== "string") return "";
  const frase = aFrase(clave);
  if (frase === "") return "";

  const delDiccionario = DICCIONARIO[canonica(frase)];
  if (delDiccionario) return delDiccionario;

  return capitalizar(frase.split(" ").map(acentuarPalabra).join(" "));
}

/** Mapa clave → etiqueta para las claves dadas. Lo usan las leyendas de los
 *  gráficos, que necesitan el diccionario ya resuelto. */
export function mapaDeEtiquetas(
  claves: readonly string[],
): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const clave of claves) mapa[clave] = formatearEtiqueta(clave);
  return mapa;
}
