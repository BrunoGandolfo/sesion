import { Buffer } from "node:buffer";

import type { Prisma, PrismaClient } from "@prisma/client";

import type { NotaSoapOriginal } from "@/lib/sesion-clinica/schema";

import { decrypt, encrypt, validateKey } from "./encryption";

// ────────────────────────────────────────────────────────────────────────────
// Cifrado en reposo (AES-256-GCM) de los campos clínicos.
//
// En la base solo existen las columnas `*Encrypted` (Bytes?). Los campos
// lógicos en claro (transcripcion, notaSubjetivo, hipotesisDiagnostica, …)
// existen en tres lugares:
//
//   LECTURA, implícita y tipada: extensión `result` de Prisma Client. Cada
//   campo lógico es un campo calculado con `needs` sobre su columna cifrada
//   y `compute` que descifra. `select: { notaSubjetivo: true }` compila,
//   trae solo la columna cifrada y devuelve `string | null`. Vale también en
//   relaciones anidadas.
//
//   ESCRITURA, explícita y tipada: `cifrarSesion` / `cifrarContexto` toman
//   campos lógicos y devuelven las columnas cifradas listas para `data`:
//     data: { estado: "revision", ...cifrarSesion({ notaSubjetivo, datosEstructurados }) }
//   `null` cifra como null (borra la columna); `undefined` no la toca.
//
//   GUARDA: extensión `query` que rechaza `where` / `orderBy` sobre campos
//   lógicos o columnas cifradas. No son consultables.
//
// Formato del blob: "ENC1" (4B) || IV (12B) || authTag (16B) || ciphertext.
// Un blob no nulo que no descifra es un dato corrupto: la lectura falla.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Contrato hacia afuera
// ────────────────────────────────────────────────────────────────────────────

/** Campos lógicos de SesionClinica: así se leen y así los acepta cifrarSesion. */
export interface CamposSesionClinica {
  transcripcion: string | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  /** Nota tal como la generó la IA. Se escribe una sola vez. */
  notaSoapOriginal: NotaSoapOriginal | null;
  /**
   * Al leer: JSON parseado (objeto del tablero), o null. Al escribir acepta
   * el objeto o el string JSON ya serializado; el string se cifra tal cual.
   */
  datosEstructurados: unknown;
  notasEdicion: string | null;
}

/** Campos lógicos de PacienteContextoClinico (Golden Thread). */
export interface CamposContextoClinico {
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  /** Timeline de flags, ya parseada; se guarda como JSON. */
  riesgosHistoricos: unknown[] | null;
}

const CAMPOS_LOGICOS_SESION = [
  "transcripcion",
  "notaSubjetivo",
  "notaObjetivo",
  "notaAnalisis",
  "notaPlan",
  "notaSoapOriginal",
  "datosEstructurados",
  "notasEdicion",
] as const satisfies readonly (keyof CamposSesionClinica)[];

const COLUMNAS_SESION = [
  "transcripcionEncrypted",
  "notaSoapEncrypted",
  "notaSoapOriginalEncrypted",
  "datosEstructuradosEncrypted",
  "notasEdicionEncrypted",
] as const;

const CAMPOS_LOGICOS_CONTEXTO = [
  "hipotesisDiagnostica",
  "resumenAcumulativo",
  "riesgosHistoricos",
] as const satisfies readonly (keyof CamposContextoClinico)[];

const COLUMNAS_CONTEXTO = [
  "hipotesisDiagnosticaEncrypted",
  "resumenAcumulativoEncrypted",
  "riesgosHistoricosEncrypted",
] as const;

/** Columnas cifradas de SesionClinica, con el tipo que Prisma acepta en `data` (create y update). */
export type ColumnasCifradasSesion = Pick<
  Prisma.SesionClinicaUncheckedCreateInput,
  (typeof COLUMNAS_SESION)[number]
>;

/** Ídem para PacienteContextoClinico. */
export type ColumnasCifradasContexto = Pick<
  Prisma.PacienteContextoClinicoUncheckedCreateInput,
  (typeof COLUMNAS_CONTEXTO)[number]
>;

// ────────────────────────────────────────────────────────────────────────────
// Utilidades
// ────────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function esObjetoPlano(valor: unknown): valor is Raw {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoONull(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

/**
 * Normaliza el blob que devuelve Prisma para Bytes? a Buffer. Prisma 5
 * entrega Buffer en Node; algunos entornos entregan Uint8Array "puro".
 */
function aBuffer(valor: unknown): Buffer | null {
  if (valor == null) return null;
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) {
    return Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength);
  }
  return null;
}

/** Cualquier objeto → las 4 claves SOAP (extras se descartan, faltantes → null). */
function normalizarNotaSoap(valor: unknown): NotaSoapOriginal | null {
  if (!esObjetoPlano(valor)) return null;
  return {
    subjetivo: textoONull(valor.subjetivo),
    objetivo: textoONull(valor.objetivo),
    analisis: textoONull(valor.analisis),
    plan: textoONull(valor.plan),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Lectura (usada por los campos calculados)
// ────────────────────────────────────────────────────────────────────────────

function descifrarTexto(blob: unknown): string | null {
  const buffer = aBuffer(blob);
  return buffer === null ? null : decrypt(buffer);
}

function descifrarJson(blob: unknown): unknown {
  const texto = descifrarTexto(blob);
  return texto === null ? null : JSON.parse(texto);
}

/** Una sección del JSON {subjetivo, objetivo, analisis, plan} de nota_soap_encrypted. */
function seccionSoap(blob: unknown, clave: keyof NotaSoapOriginal): string | null {
  return normalizarNotaSoap(descifrarJson(blob))?.[clave] ?? null;
}

function descifrarRiesgos(blob: unknown): unknown[] | null {
  const valor = descifrarJson(blob);
  return Array.isArray(valor) ? valor : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Escritura
// ────────────────────────────────────────────────────────────────────────────

function cifrarTexto(texto: string | null): Buffer | null {
  return texto === null ? null : encrypt(texto);
}

/** String JSON tal cual; objeto o array serializado; null se mantiene. */
function serializarJson(valor: unknown): string | null {
  if (valor === null) return null;
  return typeof valor === "string" ? valor : JSON.stringify(valor);
}

const SECCIONES_SOAP = [
  ["notaSubjetivo", "subjetivo"],
  ["notaObjetivo", "objetivo"],
  ["notaAnalisis", "analisis"],
  ["notaPlan", "plan"],
] as const;

/**
 * Las 4 secciones SOAP van juntas en un único JSON. Una escritura reemplaza
 * el JSON completo: las secciones no enviadas quedan en null. Si ninguna
 * sección viene, la columna no se toca; si todas vienen null, queda NULL.
 */
function empaquetarSoap(
  campos: Partial<CamposSesionClinica>,
): string | null | undefined {
  const nota: NotaSoapOriginal = {
    subjetivo: null,
    objetivo: null,
    analisis: null,
    plan: null,
  };
  let alguna = false;
  let conTexto = false;
  for (const [campo, clave] of SECCIONES_SOAP) {
    const valor = campos[campo];
    if (valor === undefined) continue;
    alguna = true;
    nota[clave] = valor;
    if (valor !== null) conTexto = true;
  }
  if (!alguna) return undefined;
  return conTexto ? JSON.stringify(nota) : null;
}

/**
 * Campos lógicos de SesionClinica → columnas cifradas para `data`.
 * `null` deja la columna en NULL; `undefined` (o ausente) no la toca.
 */
export function cifrarSesion(
  campos: Partial<CamposSesionClinica>,
): ColumnasCifradasSesion {
  const columnas: ColumnasCifradasSesion = {};
  if (campos.transcripcion !== undefined) {
    columnas.transcripcionEncrypted = cifrarTexto(campos.transcripcion);
  }
  const soap = empaquetarSoap(campos);
  if (soap !== undefined) {
    columnas.notaSoapEncrypted = cifrarTexto(soap);
  }
  if (campos.notaSoapOriginal !== undefined) {
    const nota = normalizarNotaSoap(campos.notaSoapOriginal);
    columnas.notaSoapOriginalEncrypted = cifrarTexto(
      nota === null ? null : JSON.stringify(nota),
    );
  }
  if (campos.datosEstructurados !== undefined) {
    columnas.datosEstructuradosEncrypted = cifrarTexto(
      serializarJson(campos.datosEstructurados),
    );
  }
  if (campos.notasEdicion !== undefined) {
    columnas.notasEdicionEncrypted = cifrarTexto(campos.notasEdicion);
  }
  return columnas;
}

/** Campos lógicos de PacienteContextoClinico → columnas cifradas para `data`. */
export function cifrarContexto(
  campos: Partial<CamposContextoClinico>,
): ColumnasCifradasContexto {
  const columnas: ColumnasCifradasContexto = {};
  if (campos.hipotesisDiagnostica !== undefined) {
    columnas.hipotesisDiagnosticaEncrypted = cifrarTexto(
      campos.hipotesisDiagnostica,
    );
  }
  if (campos.resumenAcumulativo !== undefined) {
    columnas.resumenAcumulativoEncrypted = cifrarTexto(campos.resumenAcumulativo);
  }
  if (campos.riesgosHistoricos !== undefined) {
    columnas.riesgosHistoricosEncrypted = cifrarTexto(
      serializarJson(campos.riesgosHistoricos),
    );
  }
  return columnas;
}

// ────────────────────────────────────────────────────────────────────────────
// Guarda: nada cifrado en where / orderBy
// ────────────────────────────────────────────────────────────────────────────

const NO_CONSULTABLES: Record<ModeloCifrado, ReadonlySet<string>> = {
  SesionClinica: new Set<string>([...CAMPOS_LOGICOS_SESION, ...COLUMNAS_SESION]),
  PacienteContextoClinico: new Set<string>([
    ...CAMPOS_LOGICOS_CONTEXTO,
    ...COLUMNAS_CONTEXTO,
  ]),
};

export type ModeloCifrado = "SesionClinica" | "PacienteContextoClinico";

function rechazar(modelo: string, campo: string, uso: "filter" | "order"): never {
  throw new Error(
    `Cannot ${uso} ${modelo} by encrypted field ${campo}. ` +
      `Use a non-encrypted column instead.`,
  );
}

function validarWhere(modelo: ModeloCifrado, where: unknown): void {
  if (!esObjetoPlano(where)) return;
  for (const [clave, valor] of Object.entries(where)) {
    if (NO_CONSULTABLES[modelo].has(clave)) rechazar(modelo, clave, "filter");
    if (clave === "AND" || clave === "OR" || clave === "NOT") {
      for (const sub of Array.isArray(valor) ? valor : [valor]) {
        validarWhere(modelo, sub);
      }
    }
  }
}

function validarOrderBy(modelo: ModeloCifrado, orderBy: unknown): void {
  if (Array.isArray(orderBy)) {
    for (const o of orderBy) validarOrderBy(modelo, o);
    return;
  }
  if (!esObjetoPlano(orderBy)) return;
  for (const clave of Object.keys(orderBy)) {
    if (NO_CONSULTABLES[modelo].has(clave)) rechazar(modelo, clave, "order");
  }
}

/**
 * Lanza si los args de una operación filtran u ordenan por un campo lógico o
 * una columna cifrada. Exportada para testearla sin pasar por Prisma.
 */
export function assertConsultaSinCifrados(
  modelo: ModeloCifrado,
  args: unknown,
): void {
  if (!esObjetoPlano(args)) return;
  validarWhere(modelo, args.where);
  validarOrderBy(modelo, args.orderBy);
}

// ────────────────────────────────────────────────────────────────────────────
// Extensión
// ────────────────────────────────────────────────────────────────────────────

export function withEncryption<C extends PrismaClient>(client: C) {
  validateKey();

  return client.$extends({
    name: "sesion-clinica-encryption",
    result: {
      sesionClinica: {
        transcripcion: {
          needs: { transcripcionEncrypted: true },
          compute: (fila) => descifrarTexto(fila.transcripcionEncrypted),
        },
        notaSubjetivo: {
          needs: { notaSoapEncrypted: true },
          compute: (fila) => seccionSoap(fila.notaSoapEncrypted, "subjetivo"),
        },
        notaObjetivo: {
          needs: { notaSoapEncrypted: true },
          compute: (fila) => seccionSoap(fila.notaSoapEncrypted, "objetivo"),
        },
        notaAnalisis: {
          needs: { notaSoapEncrypted: true },
          compute: (fila) => seccionSoap(fila.notaSoapEncrypted, "analisis"),
        },
        notaPlan: {
          needs: { notaSoapEncrypted: true },
          compute: (fila) => seccionSoap(fila.notaSoapEncrypted, "plan"),
        },
        notaSoapOriginal: {
          needs: { notaSoapOriginalEncrypted: true },
          compute: (fila) =>
            normalizarNotaSoap(descifrarJson(fila.notaSoapOriginalEncrypted)),
        },
        datosEstructurados: {
          needs: { datosEstructuradosEncrypted: true },
          compute: (fila) => descifrarJson(fila.datosEstructuradosEncrypted),
        },
        notasEdicion: {
          needs: { notasEdicionEncrypted: true },
          compute: (fila) => descifrarTexto(fila.notasEdicionEncrypted),
        },
      },
      pacienteContextoClinico: {
        hipotesisDiagnostica: {
          needs: { hipotesisDiagnosticaEncrypted: true },
          compute: (fila) => descifrarTexto(fila.hipotesisDiagnosticaEncrypted),
        },
        resumenAcumulativo: {
          needs: { resumenAcumulativoEncrypted: true },
          compute: (fila) => descifrarTexto(fila.resumenAcumulativoEncrypted),
        },
        riesgosHistoricos: {
          needs: { riesgosHistoricosEncrypted: true },
          compute: (fila) => descifrarRiesgos(fila.riesgosHistoricosEncrypted),
        },
      },
    },
    query: {
      sesionClinica: {
        $allOperations({ args, query }) {
          assertConsultaSinCifrados("SesionClinica", args);
          return query(args);
        },
      },
      pacienteContextoClinico: {
        $allOperations({ args, query }) {
          assertConsultaSinCifrados("PacienteContextoClinico", args);
          return query(args);
        },
      },
    },
  });
}
