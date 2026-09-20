// Leer y buscar en la transcripción. Funciones puras, sin React.
//
// El worker guarda la transcripción como texto, una línea por intervención:
//
//     [MM:SS] Terapeuta: texto
//     [MM:SS] Paciente: texto
//
// (processor/transcripcion.py; los minutos pasan de 99 en una sesión larga).
// Acá ese texto se parte en bloques para dibujarlos con su marca de tiempo y
// su hablante. Una línea que no tenga esa forma NO se descarta ni se
// "arregla": se muestra entera, como bloque literal. Es el texto de una
// sesión clínica; perder una línea por un formato inesperado es peor que
// mostrarla fea.

export type BloqueTranscripcion =
  | { tipo: "turno"; marca: string; hablante: string; texto: string }
  | { tipo: "literal"; texto: string };

const LINEA = /^\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^:\[\]]{1,40}):\s?(.*)$/;

export function leerTranscripcion(transcripcion: string): BloqueTranscripcion[] {
  const bloques: BloqueTranscripcion[] = [];
  for (const cruda of transcripcion.split(/\r?\n/)) {
    if (cruda.trim() === "") continue;
    const partes = LINEA.exec(cruda);
    bloques.push(
      partes
        ? { tipo: "turno", marca: partes[1], hablante: partes[2].trim(), texto: partes[3] }
        : { tipo: "literal", texto: cruda },
    );
  }
  return bloques;
}

// ────────────────────────────────────────────────────────────────────────────
// Búsqueda
//
// Sin distinguir mayúsculas ni tildes: ella escribe "angustia" o "mama" y
// tiene que encontrar "Angustia" y "mamá". El plegado es carácter a carácter
// y cada carácter sigue ocupando un lugar, así las posiciones encontradas en
// el texto plegado valen tal cual sobre el original, que es el que se resalta.
// ────────────────────────────────────────────────────────────────────────────

export const MINIMO_BUSQUEDA = 2;

function plegar(texto: string): string {
  let salida = "";
  for (let i = 0; i < texto.length; i += 1) {
    const original = texto[i];
    const plegado = original.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    salida += plegado.length === 1 ? plegado : original;
  }
  return salida;
}

export interface Coincidencia {
  /** Índice del bloque en la lista. */
  bloque: number;
  /** Posiciones dentro de `texto` del bloque. */
  inicio: number;
  fin: number;
}

/** Todas las apariciones, en orden de lectura. Se busca en lo que se dijo,
 *  no en la marca de tiempo ni en el nombre del hablante. */
export function buscarEnBloques(
  bloques: readonly BloqueTranscripcion[],
  consulta: string,
): Coincidencia[] {
  const aguja = plegar(consulta.trim());
  if (aguja.length < MINIMO_BUSQUEDA) return [];

  const coincidencias: Coincidencia[] = [];
  bloques.forEach((bloque, indice) => {
    const pajar = plegar(bloque.texto);
    let desde = pajar.indexOf(aguja);
    while (desde !== -1) {
      coincidencias.push({ bloque: indice, inicio: desde, fin: desde + aguja.length });
      desde = pajar.indexOf(aguja, desde + aguja.length);
    }
  });
  return coincidencias;
}
