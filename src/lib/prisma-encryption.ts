import { Buffer } from "node:buffer";

import type { PrismaClient } from "@prisma/client";

import { decrypt, encrypt, isEncrypted, validateKey } from "./encryption";

const LOGICAL_FIELDS = [
  "transcripcion",
  "notaSubjetivo",
  "notaObjetivo",
  "notaAnalisis",
  "notaPlan",
  "datosEstructurados",
  "notasEdicion",
  // Objeto {subjetivo, objetivo, analisis, plan} | null ↔ notaSoapOriginalEncrypted
  // (mismo bundle JSON que notaSoapEncrypted, pero sin desarmar en 4 campos).
  "notaSoapOriginal",
] as const;
type LogicalField = (typeof LOGICAL_FIELDS)[number];
const LOGICAL_FIELD_SET = new Set<string>(LOGICAL_FIELDS);

// Mismos invariantes que SesionClinica pero para el contexto longitudinal del
// paciente (Golden Thread). Tres campos PHI separados, sin bundling: cada uno
// se consume independientemente (el resumen va al prompt del LLM, la hipótesis
// va al panel de la terapeuta, riesgos al banner de alerta), así que no
// conviene meterlos en un JSON único como notaSoap.
const CONTEXTO_LOGICAL_FIELDS = [
  "hipotesisDiagnostica",
  "resumenAcumulativo",
  "riesgosHistoricos",
] as const;
const CONTEXTO_LOGICAL_FIELD_SET = new Set<string>(CONTEXTO_LOGICAL_FIELDS);

const SOAP_LOGICAL = [
  "notaSubjetivo",
  "notaObjetivo",
  "notaAnalisis",
  "notaPlan",
] as const;
type SoapLogical = (typeof SOAP_LOGICAL)[number];
type SoapKey = "subjetivo" | "objetivo" | "analisis" | "plan";

function soapKeyOf(field: SoapLogical): SoapKey {
  switch (field) {
    case "notaSubjetivo":
      return "subjetivo";
    case "notaObjetivo":
      return "objetivo";
    case "notaAnalisis":
      return "analisis";
    case "notaPlan":
      return "plan";
  }
}

type Raw = Record<string, unknown>;

function isPlainObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normaliza el blob crudo que devuelve Prisma para columnas Bytes? a Buffer.
 * Prisma 5 documenta `Uint8Array` como tipo de salida pero en la práctica
 * devuelve Buffer en la mayoría de los entornos (postgres-js sobre Node).
 * Algunos entornos (edge runtime, ciertas builds) devuelven Uint8Array
 * "puro": esos no pasan Buffer.isBuffer y haríamos un fallback legacy
 * incorrecto. Buffer.from(uint8.buffer, byteOffset, byteLength) crea un
 * Buffer view sobre la misma memoria, sin copiar.
 */
function toBuffer(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function rejectEncryptedField(
  model: string,
  field: string,
  kind: "filter" | "order",
): never {
  throw new Error(
    `Cannot ${kind} ${model} by encrypted field ${field}. ` +
      `Use a non-encrypted column instead.`,
  );
}

function makeAssertNoEncryptedInWhere(
  model: string,
  fieldSet: ReadonlySet<string>,
) {
  const fn = (where: unknown): void => {
    if (!isPlainObject(where)) return;
    for (const [k, v] of Object.entries(where)) {
      if (fieldSet.has(k)) rejectEncryptedField(model, k, "filter");
      if (k === "AND" || k === "OR" || k === "NOT") {
        if (Array.isArray(v)) {
          for (const sub of v) fn(sub);
        } else {
          fn(v);
        }
      }
    }
  };
  return fn;
}

function makeAssertNoEncryptedInOrderBy(
  model: string,
  fieldSet: ReadonlySet<string>,
) {
  const fn = (orderBy: unknown): void => {
    if (orderBy === undefined || orderBy === null) return;
    if (Array.isArray(orderBy)) {
      for (const o of orderBy) fn(o);
      return;
    }
    if (!isPlainObject(orderBy)) return;
    for (const k of Object.keys(orderBy)) {
      if (fieldSet.has(k)) rejectEncryptedField(model, k, "order");
    }
  };
  return fn;
}

const assertNoEncryptedInWhere = makeAssertNoEncryptedInWhere(
  "SesionClinica",
  LOGICAL_FIELD_SET,
);
const assertNoEncryptedInOrderBy = makeAssertNoEncryptedInOrderBy(
  "SesionClinica",
  LOGICAL_FIELD_SET,
);
const assertNoContextoEncryptedInWhere = makeAssertNoEncryptedInWhere(
  "PacienteContextoClinico",
  CONTEXTO_LOGICAL_FIELD_SET,
);
const assertNoContextoEncryptedInOrderBy = makeAssertNoEncryptedInOrderBy(
  "PacienteContextoClinico",
  CONTEXTO_LOGICAL_FIELD_SET,
);

function transformWriteData(data: Raw): Raw {
  const out: Raw = { ...data };

  if ("transcripcion" in out) {
    const v = out.transcripcion;
    delete out.transcripcion;
    if (v === null) {
      out.transcripcionEncrypted = null;
    } else if (typeof v === "string") {
      out.transcripcionEncrypted = encrypt(v);
    }
  }

  const hasAnySoap = SOAP_LOGICAL.some((f) => f in out);
  if (hasAnySoap) {
    const soap: Record<SoapKey, string | null> = {
      subjetivo: null,
      objetivo: null,
      analisis: null,
      plan: null,
    };
    let anyDefined = false;
    let anyNonNull = false;
    for (const f of SOAP_LOGICAL) {
      if (f in out) {
        const v = out[f];
        delete out[f];
        if (v !== undefined) {
          anyDefined = true;
          if (v === null) {
            soap[soapKeyOf(f)] = null;
          } else if (typeof v === "string") {
            soap[soapKeyOf(f)] = v;
            anyNonNull = true;
          }
        }
      }
    }
    if (anyNonNull) {
      out.notaSoapEncrypted = encrypt(JSON.stringify(soap));
    } else if (anyDefined) {
      out.notaSoapEncrypted = null;
    }
  }

  if ("datosEstructurados" in out) {
    const v = out.datosEstructurados;
    delete out.datosEstructurados;
    if (v === null) {
      out.datosEstructuradosEncrypted = null;
    } else if (typeof v === "string") {
      out.datosEstructuradosEncrypted = encrypt(v);
    } else if (isPlainObject(v) || Array.isArray(v)) {
      out.datosEstructuradosEncrypted = encrypt(JSON.stringify(v));
    }
  }

  if ("notasEdicion" in out) {
    const v = out.notasEdicion;
    delete out.notasEdicion;
    if (v === null) {
      out.notasEdicionEncrypted = null;
    } else if (typeof v === "string") {
      out.notasEdicionEncrypted = encrypt(v);
    }
  }

  if ("notaSoapOriginal" in out) {
    const v = out.notaSoapOriginal;
    delete out.notaSoapOriginal;
    if (v === null) {
      out.notaSoapOriginalEncrypted = null;
    } else if (isPlainObject(v)) {
      // Solo las 4 claves SOAP: cualquier extra del caller se descarta para
      // que el blob tenga exactamente la misma forma que notaSoapEncrypted.
      const soap: Record<SoapKey, unknown> = {
        subjetivo: v.subjetivo ?? null,
        objetivo: v.objetivo ?? null,
        analisis: v.analisis ?? null,
        plan: v.plan ?? null,
      };
      out.notaSoapOriginalEncrypted = encrypt(JSON.stringify(soap));
    }
  }

  return out;
}

function injectEncryptedSelect(args: Raw): Raw {
  if (!isPlainObject(args.select)) return args;
  const select: Raw = { ...args.select };
  if (select.transcripcion === true) select.transcripcionEncrypted = true;
  if (SOAP_LOGICAL.some((f) => select[f] === true)) {
    select.notaSoapEncrypted = true;
  }
  if (select.datosEstructurados === true) {
    select.datosEstructuradosEncrypted = true;
  }
  if (select.notasEdicion === true) select.notasEdicionEncrypted = true;
  if (select.notaSoapOriginal === true) {
    // A diferencia del resto, este campo lógico NO tiene columna legacy en el
    // schema: hay que quitarlo del select o Prisma lo rechaza como campo
    // desconocido. transformRow lo repone a partir de la columna cifrada.
    select.notaSoapOriginalEncrypted = true;
    delete select.notaSoapOriginal;
  }
  return { ...args, select };
}

function wasFieldRequested(
  originalSelect: Raw | undefined,
  field: LogicalField,
): boolean {
  if (!originalSelect) return true;
  return originalSelect[field] === true;
}

function transformRow(row: unknown, originalSelect: Raw | undefined): unknown {
  if (!isPlainObject(row)) return row;

  if ("transcripcionEncrypted" in row) {
    const blob = toBuffer(row.transcripcionEncrypted);
    if (blob && isEncrypted(blob)) {
      row.transcripcion = decrypt(blob);
    } else if (blob) {
      console.warn(
        "[prisma-encryption] transcripcionEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.transcripcionEncrypted;
  }

  if ("notaSoapEncrypted" in row) {
    const blob = toBuffer(row.notaSoapEncrypted);
    if (blob && isEncrypted(blob)) {
      let parsed: Partial<Record<SoapKey, string | null>>;
      try {
        const json = decrypt(blob);
        parsed = JSON.parse(json) as Partial<Record<SoapKey, string | null>>;
      } catch (err) {
        throw new Error(
          `Failed to decrypt or parse notaSoapEncrypted: ${(err as Error).message}`,
        );
      }
      if (wasFieldRequested(originalSelect, "notaSubjetivo")) {
        row.notaSubjetivo = parsed.subjetivo ?? null;
      }
      if (wasFieldRequested(originalSelect, "notaObjetivo")) {
        row.notaObjetivo = parsed.objetivo ?? null;
      }
      if (wasFieldRequested(originalSelect, "notaAnalisis")) {
        row.notaAnalisis = parsed.analisis ?? null;
      }
      if (wasFieldRequested(originalSelect, "notaPlan")) {
        row.notaPlan = parsed.plan ?? null;
      }
    } else if (blob) {
      console.warn(
        "[prisma-encryption] notaSoapEncrypted lacks magic prefix; falling back to legacy columns",
      );
    }
    delete row.notaSoapEncrypted;
  }

  if ("datosEstructuradosEncrypted" in row) {
    const blob = toBuffer(row.datosEstructuradosEncrypted);
    if (blob && isEncrypted(blob)) {
      row.datosEstructurados = JSON.parse(decrypt(blob));
    } else if (blob) {
      console.warn(
        "[prisma-encryption] datosEstructuradosEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.datosEstructuradosEncrypted;
  }

  if ("notasEdicionEncrypted" in row) {
    const blob = toBuffer(row.notasEdicionEncrypted);
    if (blob && isEncrypted(blob)) {
      row.notasEdicion = decrypt(blob);
    } else if (blob) {
      console.warn(
        "[prisma-encryption] notasEdicionEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.notasEdicionEncrypted;
  }

  if ("notaSoapOriginalEncrypted" in row) {
    const blob = toBuffer(row.notaSoapOriginalEncrypted);
    row.notaSoapOriginal = null;
    if (blob && isEncrypted(blob)) {
      try {
        const parsed: unknown = JSON.parse(decrypt(blob));
        row.notaSoapOriginal = isPlainObject(parsed)
          ? {
              subjetivo: parsed.subjetivo ?? null,
              objetivo: parsed.objetivo ?? null,
              analisis: parsed.analisis ?? null,
              plan: parsed.plan ?? null,
            }
          : null;
      } catch (err) {
        throw new Error(
          `Failed to decrypt or parse notaSoapOriginalEncrypted: ${(err as Error).message}`,
        );
      }
    } else if (blob) {
      // No hay columna legacy para este campo: un blob sin magic es
      // inservible, se devuelve null.
      console.warn(
        "[prisma-encryption] notaSoapOriginalEncrypted lacks magic prefix; returning null",
      );
    }
    delete row.notaSoapOriginalEncrypted;
  }

  return row;
}

function originalSelectOf(args: Raw): Raw | undefined {
  return isPlainObject(args.select) ? args.select : undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// PacienteContextoClinico — Golden Thread.
//
// Simétrico al pipeline de SesionClinica pero sin bundling: cada campo PHI
// va a su propia columna `*_encrypted`. `hipotesisDiagnostica` y
// `resumenAcumulativo` son strings de prosa clínica; `riesgosHistoricos` es
// un array de objetos (timeline de flags), que se serializa a JSON antes de
// cifrar y se re-parsea al leer.
// ────────────────────────────────────────────────────────────────────────────

function transformContextoWriteData(data: Raw): Raw {
  const out: Raw = { ...data };

  if ("hipotesisDiagnostica" in out) {
    const v = out.hipotesisDiagnostica;
    delete out.hipotesisDiagnostica;
    if (v === null) {
      out.hipotesisDiagnosticaEncrypted = null;
    } else if (typeof v === "string") {
      out.hipotesisDiagnosticaEncrypted = encrypt(v);
    }
  }

  if ("resumenAcumulativo" in out) {
    const v = out.resumenAcumulativo;
    delete out.resumenAcumulativo;
    if (v === null) {
      out.resumenAcumulativoEncrypted = null;
    } else if (typeof v === "string") {
      out.resumenAcumulativoEncrypted = encrypt(v);
    }
  }

  if ("riesgosHistoricos" in out) {
    const v = out.riesgosHistoricos;
    delete out.riesgosHistoricos;
    if (v === null) {
      out.riesgosHistoricosEncrypted = null;
    } else if (typeof v === "string") {
      // Si ya viene serializado lo cifrámos tal cual; el lado de lectura
      // siempre JSON.parse para devolver objeto.
      out.riesgosHistoricosEncrypted = encrypt(v);
    } else if (isPlainObject(v) || Array.isArray(v)) {
      out.riesgosHistoricosEncrypted = encrypt(JSON.stringify(v));
    }
  }

  return out;
}

function injectContextoEncryptedSelect(args: Raw): Raw {
  if (!isPlainObject(args.select)) return args;
  const select: Raw = { ...args.select };
  if (select.hipotesisDiagnostica === true) {
    select.hipotesisDiagnosticaEncrypted = true;
  }
  if (select.resumenAcumulativo === true) {
    select.resumenAcumulativoEncrypted = true;
  }
  if (select.riesgosHistoricos === true) {
    select.riesgosHistoricosEncrypted = true;
  }
  return { ...args, select };
}

function transformContextoRow(row: unknown): unknown {
  if (!isPlainObject(row)) return row;

  if ("hipotesisDiagnosticaEncrypted" in row) {
    const blob = toBuffer(row.hipotesisDiagnosticaEncrypted);
    if (blob && isEncrypted(blob)) {
      row.hipotesisDiagnostica = decrypt(blob);
    } else if (blob) {
      console.warn(
        "[prisma-encryption] hipotesisDiagnosticaEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.hipotesisDiagnosticaEncrypted;
  }

  if ("resumenAcumulativoEncrypted" in row) {
    const blob = toBuffer(row.resumenAcumulativoEncrypted);
    if (blob && isEncrypted(blob)) {
      row.resumenAcumulativo = decrypt(blob);
    } else if (blob) {
      console.warn(
        "[prisma-encryption] resumenAcumulativoEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.resumenAcumulativoEncrypted;
  }

  if ("riesgosHistoricosEncrypted" in row) {
    const blob = toBuffer(row.riesgosHistoricosEncrypted);
    if (blob && isEncrypted(blob)) {
      try {
        row.riesgosHistoricos = JSON.parse(decrypt(blob));
      } catch (err) {
        throw new Error(
          `Failed to decrypt or parse riesgosHistoricosEncrypted: ${(err as Error).message}`,
        );
      }
    } else if (blob) {
      console.warn(
        "[prisma-encryption] riesgosHistoricosEncrypted lacks magic prefix; falling back to legacy column",
      );
    }
    delete row.riesgosHistoricosEncrypted;
  }

  return row;
}

export function withEncryption<C extends PrismaClient>(client: C) {
  validateKey();

  return client.$extends({
    name: "sesion-clinica-encryption",
    query: {
      sesionClinica: {
        async create({ args, query }) {
          const a = args as unknown as Raw;
          if (isPlainObject(a.data)) {
            a.data = transformWriteData(a.data);
          }
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async createMany({ args, query }) {
          const a = args as unknown as Raw;
          if (Array.isArray(a.data)) {
            a.data = a.data.map((d) =>
              isPlainObject(d) ? transformWriteData(d) : d,
            );
          } else if (isPlainObject(a.data)) {
            a.data = transformWriteData(a.data);
          }
          return query(args);
        },
        async update({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          if (isPlainObject(a.data)) {
            a.data = transformWriteData(a.data);
          }
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async updateMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          if (isPlainObject(a.data)) {
            a.data = transformWriteData(a.data);
          }
          return query(args);
        },
        async upsert({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          if (isPlainObject(a.create)) {
            a.create = transformWriteData(a.create);
          }
          if (isPlainObject(a.update)) {
            a.update = transformWriteData(a.update);
          }
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async findUnique({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async findUniqueOrThrow({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async findFirst({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          assertNoEncryptedInOrderBy(a.orderBy);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async findFirstOrThrow({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          assertNoEncryptedInOrderBy(a.orderBy);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async findMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          assertNoEncryptedInOrderBy(a.orderBy);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          if (Array.isArray(result)) {
            return result.map((row) =>
              transformRow(row, original),
            ) as typeof result;
          }
          return result;
        },
        async delete({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          const original = originalSelectOf(a);
          const modified = injectEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformRow(result, original) as typeof result;
        },
        async deleteMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoEncryptedInWhere(a.where);
          return query(args);
        },
      },
      pacienteContextoClinico: {
        async create({ args, query }) {
          const a = args as unknown as Raw;
          if (isPlainObject(a.data)) {
            a.data = transformContextoWriteData(a.data);
          }
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async createMany({ args, query }) {
          const a = args as unknown as Raw;
          if (Array.isArray(a.data)) {
            a.data = a.data.map((d) =>
              isPlainObject(d) ? transformContextoWriteData(d) : d,
            );
          } else if (isPlainObject(a.data)) {
            a.data = transformContextoWriteData(a.data);
          }
          return query(args);
        },
        async update({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          if (isPlainObject(a.data)) {
            a.data = transformContextoWriteData(a.data);
          }
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async updateMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          if (isPlainObject(a.data)) {
            a.data = transformContextoWriteData(a.data);
          }
          return query(args);
        },
        async upsert({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          if (isPlainObject(a.create)) {
            a.create = transformContextoWriteData(a.create);
          }
          if (isPlainObject(a.update)) {
            a.update = transformContextoWriteData(a.update);
          }
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async findUnique({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async findUniqueOrThrow({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async findFirst({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          assertNoContextoEncryptedInOrderBy(a.orderBy);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async findFirstOrThrow({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          assertNoContextoEncryptedInOrderBy(a.orderBy);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async findMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          assertNoContextoEncryptedInOrderBy(a.orderBy);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          if (Array.isArray(result)) {
            return result.map((row) =>
              transformContextoRow(row),
            ) as typeof result;
          }
          return result;
        },
        async delete({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          const modified = injectContextoEncryptedSelect(a) as typeof args;
          const result = await query(modified);
          return transformContextoRow(result) as typeof result;
        },
        async deleteMany({ args, query }) {
          const a = args as unknown as Raw;
          assertNoContextoEncryptedInWhere(a.where);
          return query(args);
        },
      },
    },
  });
}
