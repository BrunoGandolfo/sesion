// Campos cifrados de la sesión clínica: el ÚNICO lugar del área 2 que sabe
// qué columna guarda cada campo lógico y cómo se cifra.
//
// ─── COSTURA CON EL ÁREA 3 (cifrado v2) ─────────────────────────────────────
//
// El contrato definitivo (docs/esquema.md, anexo; diseño 03 §2.4) es:
//   - lectura: campos lógicos calculados por la extensión de Prisma
//     (`select: { notaIa: true }` devuelve el objeto descifrado);
//   - escritura: `cifrarSesion(id, campos)` de src/lib/prisma-encryption.ts,
//     con AAD `sesiones_clinicas:<columna>:<id>`.
//
// Hasta que esa extensión exista, este módulo cumple el mismo contrato con
// las primitivas de hoy (src/lib/encryption.ts, formato ENC1, sin AAD): los
// casos de uso ya hablan en términos de campos lógicos y del id de la fila,
// y el día que el Área 3 entregue lo suyo, `cifrarSesion` y
// `descifrarSesion` de acá pasan a delegar (o se borran y SESION_SELECT pide
// los campos lógicos). Ningún otro archivo del área toca `encrypt`/`decrypt`.

import { Buffer } from "node:buffer";

import type { Prisma } from "@prisma/client";

import { decrypt, encrypt } from "@/lib/encryption";
import type { NotaSoap } from "@/lib/sesion-clinica/schema";

/** Campos lógicos cifrados de sesiones_clinicas (anexo de docs/esquema.md). */
export interface CamposCifradosSesion {
  /** Clave AES-256 del audio, base64. Se destruye (null) al aprobar. */
  audioClave: string | null;
  /** Transcripción formateada para leer y para el modelo. */
  transcripcion: string | null;
  /** Nota tal como la generó la IA en la generación vigente. */
  notaIa: NotaSoap | null;
  /** Datos estructurados (riesgo, intervenciones, menciones…). Sin feedback. */
  datos: unknown;
  /** El reporte "Para vos". */
  feedback: unknown;
  /** Lo que ella aprobó, con sus ediciones. */
  notaFinal: NotaSoap | null;
  /** Comentarios de la profesional al aprobar. */
  notasEdicion: string | null;
}

export const COLUMNA_DE_CAMPO = {
  audioClave: "audioClaveEncrypted",
  transcripcion: "transcripcionEncrypted",
  notaIa: "notaIaEncrypted",
  datos: "datosEncrypted",
  feedback: "feedbackEncrypted",
  notaFinal: "notaFinalEncrypted",
  notasEdicion: "notasEdicionEncrypted",
} as const satisfies Record<keyof CamposCifradosSesion, string>;

export type ColumnaCifradaSesion =
  (typeof COLUMNA_DE_CAMPO)[keyof typeof COLUMNA_DE_CAMPO];

/** Columnas cifradas listas para `data` de un update de sesiones_clinicas. */
export type ColumnasCifradasSesion = Pick<
  Prisma.SesionClinicaUncheckedCreateInput,
  ColumnaCifradaSesion
>;

const CAMPOS_TEXTO = new Set<keyof CamposCifradosSesion>([
  "audioClave",
  "transcripcion",
  "notasEdicion",
]);

// AAD del formato v2. Hoy no se usa (ENC1 no lo lleva); queda calculado para
// que el cambio al v2 sea una línea por función.
function aad(sesionId: string, columna: ColumnaCifradaSesion): string {
  return `sesiones_clinicas:${columna}:${sesionId}`;
}

function cifrarValor(
  sesionId: string,
  campo: keyof CamposCifradosSesion,
  valor: unknown,
): Buffer | null {
  if (valor === null) return null;
  const texto = CAMPOS_TEXTO.has(campo)
    ? String(valor)
    : JSON.stringify(valor);
  void aad(sesionId, COLUMNA_DE_CAMPO[campo]);
  return encrypt(texto);
}

/**
 * Campos lógicos → columnas cifradas para `data`. `null` deja la columna en
 * NULL; `undefined` (o ausente) no la toca. Misma semántica que tendrá
 * `cifrarSesion(id, campos)` del Área 3.
 */
export function cifrarSesion(
  sesionId: string,
  campos: Partial<CamposCifradosSesion>,
): ColumnasCifradasSesion {
  const columnas: Record<string, Buffer | null> = {};
  for (const campo of Object.keys(COLUMNA_DE_CAMPO) as Array<
    keyof CamposCifradosSesion
  >) {
    if (!(campo in campos)) continue;
    const valor = campos[campo];
    if (valor === undefined) continue;
    columnas[COLUMNA_DE_CAMPO[campo]] = cifrarValor(sesionId, campo, valor);
  }
  return columnas as ColumnasCifradasSesion;
}

function aBuffer(valor: unknown): Buffer | null {
  if (valor == null) return null;
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) {
    return Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength);
  }
  return null;
}

/** Un blob → el campo lógico. null si la columna está en NULL. */
export function descifrarCampo<K extends keyof CamposCifradosSesion>(
  sesionId: string,
  campo: K,
  blob: unknown,
): CamposCifradosSesion[K] {
  const buffer = aBuffer(blob);
  if (buffer === null) return null as CamposCifradosSesion[K];
  void aad(sesionId, COLUMNA_DE_CAMPO[campo]);
  const texto = decrypt(buffer);
  return (CAMPOS_TEXTO.has(campo) ? texto : JSON.parse(texto)) as CamposCifradosSesion[K];
}

type FilaConColumnas = Partial<Record<ColumnaCifradaSesion, unknown>>;

/**
 * Fila con columnas cifradas → campos lógicos (sólo los que la fila trae).
 * Es lo que la extensión del Área 3 hará por su cuenta con `needs`.
 */
export function descifrarSesion(
  sesionId: string,
  fila: FilaConColumnas,
): Partial<CamposCifradosSesion> {
  const campos: Partial<CamposCifradosSesion> = {};
  for (const campo of Object.keys(COLUMNA_DE_CAMPO) as Array<
    keyof CamposCifradosSesion
  >) {
    const columna = COLUMNA_DE_CAMPO[campo];
    if (!(columna in fila)) continue;
    (campos as Record<string, unknown>)[campo] = descifrarCampo(
      sesionId,
      campo,
      fila[columna],
    );
  }
  return campos;
}
