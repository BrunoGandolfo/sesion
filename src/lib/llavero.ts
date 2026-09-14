// El llavero: las claves con que se cifran las columnas *_encrypted.
//
// Una sola variable de entorno, CLAVES_CIFRADO, con la lista de claves:
//
//   CLAVES_CIFRADO="1=<32 bytes en base64>"                 (normal)
//   CLAVES_CIFRADO="1=<base64 vieja>,2=<base64 nueva>"      (rotando)
//
// La clave ACTIVA es la de id más alto: todo lo que se cifra de acá en más
// sale con ella. Las demás siguen en el llavero solo para LEER lo que se
// cifró antes; el cron de mantenimiento re-cifra de a tandas y, cuando no
// queda ninguna fila con una clave vieja, esa clave se saca de la variable.
// Cada blob lleva el id de su clave (byte 4 del formato ENC2), así que
// descifrar sabe cuál pedir sin adivinar.
//
// No hay tabla de claves (decisión del dueño): una variable con lista evita
// coordinar dos lugares. Y no hay fallback a NOTES_ENCRYPTION_KEY: esa
// variable dejó de existir con el esquema nuevo.
//
// Módulo de Node (Buffer). No es alcanzable desde src/proxy.ts, y no tiene
// que serlo: el proxy no cifra ni descifra nada.

import { Buffer } from "node:buffer";

export const VARIABLE_LLAVERO = "CLAVES_CIFRADO";

/** Largo de cada clave: AES-256. */
export const LARGO_CLAVE_BYTES = 32;

/** El id viaja en un byte del blob: 1..255. El 0 queda reservado. */
export const ID_CLAVE_MIN = 1;
export const ID_CLAVE_MAX = 255;

export interface ClaveCifrado {
  id: number;
  clave: Buffer;
}

export interface Llavero {
  /** La de id más alto: con esta se cifra todo lo nuevo. */
  activa: ClaveCifrado;
  /** Ids presentes, ordenados de menor a mayor. */
  ids: readonly number[];
  porId(id: number): ClaveCifrado | null;
}

export class ErrorLlavero extends Error {
  constructor(mensaje: string) {
    super(`${VARIABLE_LLAVERO}: ${mensaje}`);
    this.name = "ErrorLlavero";
  }
}

/**
 * Parsea el texto de la variable. Función pura: no lee el entorno, así se
 * puede probar con cualquier valor. Lanza ErrorLlavero con un mensaje que
 * dice qué está mal (nunca el valor de una clave).
 */
export function parsearLlavero(texto: string | undefined): Llavero {
  if (typeof texto !== "string" || texto.trim() === "") {
    throw new ErrorLlavero(
      `falta o está vacía (esperado "1=<32 bytes en base64>[,2=…]")`,
    );
  }

  const claves = new Map<number, Buffer>();

  for (const cruda of texto.split(",")) {
    const entrada = cruda.trim();
    if (entrada === "") continue;

    const separador = entrada.indexOf("=");
    if (separador <= 0) {
      throw new ErrorLlavero(`entrada sin "id=clave"`);
    }

    const idTexto = entrada.slice(0, separador).trim();
    const claveTexto = entrada.slice(separador + 1).trim();

    if (!/^\d+$/.test(idTexto)) {
      throw new ErrorLlavero(`id "${idTexto}" no es un entero`);
    }
    const id = Number(idTexto);
    if (id < ID_CLAVE_MIN || id > ID_CLAVE_MAX) {
      throw new ErrorLlavero(
        `id ${id} fuera de rango (${ID_CLAVE_MIN}..${ID_CLAVE_MAX})`,
      );
    }
    if (claves.has(id)) {
      throw new ErrorLlavero(`id ${id} repetido`);
    }

    const clave = Buffer.from(claveTexto, "base64");
    if (
      clave.length !== LARGO_CLAVE_BYTES ||
      // Buffer.from tolera basura: se comprueba que el base64 sea de verdad
      // la codificación de esos bytes.
      clave.toString("base64").replace(/=+$/, "") !==
        claveTexto.replace(/=+$/, "")
    ) {
      throw new ErrorLlavero(
        `la clave ${id} no decodifica a ${LARGO_CLAVE_BYTES} bytes en base64`,
      );
    }

    claves.set(id, clave);
  }

  if (claves.size === 0) {
    throw new ErrorLlavero("no tiene ninguna clave");
  }

  const ids = [...claves.keys()].sort((a, b) => a - b);
  const idActiva = ids[ids.length - 1];

  return {
    activa: { id: idActiva, clave: claves.get(idActiva)! },
    ids,
    porId: (id) => {
      const clave = claves.get(id);
      return clave ? { id, clave } : null;
    },
  };
}

let cache: Llavero | null = null;

/** El llavero del proceso, leído de CLAVES_CIFRADO una sola vez. */
export function llavero(): Llavero {
  cache ??= parsearLlavero(process.env[VARIABLE_LLAVERO]);
  return cache;
}

export function claveActiva(): ClaveCifrado {
  return llavero().activa;
}

/**
 * La clave con ese id. Si no está en el llavero, error explícito: es la
 * situación de "se sacó la clave vieja antes de terminar de re-cifrar", y
 * tiene que gritar, nunca devolver un texto vacío.
 */
export function clavePorId(id: number): ClaveCifrado {
  const clave = llavero().porId(id);
  if (!clave) {
    throw new ErrorLlavero(`clave ${id} ausente del llavero`);
  }
  return clave;
}

/** Valida la variable al arrancar (la llama withEncryption al construir el
 *  cliente): sin llavero válido la app no arranca. */
export function validarLlavero(): void {
  llavero();
}

/** @internal Solo tests: vuelve a leer la variable en la próxima llamada. */
export function __resetLlaveroForTests(): void {
  cache = null;
}
