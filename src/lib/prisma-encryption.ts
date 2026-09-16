// Cifrado en reposo de las columnas *_encrypted, como extensión de Prisma.
//
// En la base solo existen las columnas `*Encrypted` (Bytes). Los campos
// lógicos en claro (notas, transcripcion, notaIa, contenido, …) NO están en
// prisma/schema.prisma: los define este módulo, en la tabla CAMPOS_CIFRADOS,
// y existen en tres lugares:
//
//   LECTURA, implícita y tipada: extensión `result`. Cada campo lógico es
//   un campo calculado con `needs` sobre su columna cifrada Y sobre `id`
//   (el AAD lo necesita) y `compute` que descifra.
//     db.paciente.findFirst({ select: { id: true, notas: true } })
//
//   ESCRITURA, explícita y tipada: cifrarPaciente / cifrarTurno /
//   cifrarConsentimiento / cifrarHotWord / cifrarSesion / cifrarHiloVersion.
//   Reciben el id de la fila y los campos lógicos, y devuelven `{ id,
//   ...columnas cifradas }` listo para `data`:
//     data: { ...otros, ...cifrarTurno(id, { notas }) }
//   `null` cifra como null (deja la columna en NULL); `undefined` o ausente
//   no la toca. El id tiene que existir ANTES del create (por eso los ids
//   son uuid generados por la app: `crypto.randomUUID()`), porque el AAD
//   es "<tabla>:<columna>:<id>" y ata el blob a su celda.
//
//   GUARDAS, en la extensión `query`, para los seis modelos:
//     1. Ningún `where` ni `orderBy` sobre un campo lógico o una columna
//        cifrada: no son consultables.
//     2. Toda escritura de una columna cifrada tiene que traer el id de la
//        fila (`data.id` en create/createMany, `where.id` en update/
//        updateMany, ambos en upsert) y el blob tiene que descifrar con el
//        AAD de esa fila. Un `create` sin id, o un blob cifrado para otra
//        fila, se rechaza antes de llegar a la base. Es lo que hace que el
//        AAD sea una garantía y no una convención.
//
// Las mismas guardas recorren las escrituras anidadas siguiendo las relaciones
// del schema generado, incluso desde un modelo sin columnas cifradas. Un update
// anidado de una relación singular también exige where.id: data.id no prueba
// cuál es su fila destino. No se resuelve ese id con una lectura separada.

import { Buffer } from "node:buffer";

import { Prisma, type PrismaClient } from "@prisma/client";

import { aadDe, cifrar, descifrar, ErrorDescifrado } from "./encryption";
import { validarLlavero } from "./llavero";

// ────────────────────────────────────────────────────────────────────────────
// Tipos de los campos lógicos (así se leen y así los aceptan los cifrarX)
// ────────────────────────────────────────────────────────────────────────────

/** Una nota SOAP: las cuatro secciones, cada una texto o null. */
export interface NotaSoap {
  subjetivo: string | null;
  objetivo: string | null;
  analisis: string | null;
  plan: string | null;
}

export interface CamposPaciente {
  /** Notas privadas de la ficha. */
  notas: string | null;
}

export interface CamposTurno {
  /** Nota privada del turno. */
  notas: string | null;
}

export interface CamposConsentimiento {
  /** Texto íntegro que la paciente firmó. */
  textoCompleto: string;
  /** Firma del canvas (base64). */
  firmaDigital: string;
}

export interface CamposHotWord {
  termino: string;
}

export interface CamposSesionClinica {
  /** Clave AES del audio, en base64. NULL después de aprobar. */
  audioClave: string | null;
  transcripcion: string | null;
  /** Nota tal como la generó la IA en la generación vigente. */
  notaIa: NotaSoap | null;
  /**
   * Datos estructurados (riesgo, intervenciones, menciones léxicas…). Al
   * leer: JSON parseado. Al escribir acepta el objeto, o el string JSON ya
   * serializado (se cifra tal cual).
   */
  datos: unknown;
  /** El reporte "Para vos". Misma regla que `datos`. */
  feedback: unknown;
  /** Lo que la profesional aprobó, con sus ediciones. */
  notaFinal: NotaSoap | null;
  /** Comentarios de la profesional al aprobar. */
  notasEdicion: string | null;
}

export interface CamposHiloVersion {
  /** Todo el contenido de la versión, un solo JSON. Misma regla que `datos`. */
  contenido: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// La tabla: modelo → tabla SQL → campo lógico → columna (Prisma y SQL)
// ────────────────────────────────────────────────────────────────────────────

/** Cómo se serializa el campo antes de cifrar y cómo se lee después. */
type TipoCampo =
  | "texto" // string tal cual
  | "json" // objeto/array → JSON.stringify; string → tal cual; lee JSON.parse
  | "nota"; // NotaSoap normalizada a sus 4 claves → JSON

interface DefCampo {
  columna: string;
  columnaSql: string;
  tipo: TipoCampo;
}

interface DefModelo {
  tabla: string;
  campos: Record<string, DefCampo>;
}

function campo(columna: string, columnaSql: string, tipo: TipoCampo): DefCampo {
  return { columna, columnaSql, tipo };
}

/**
 * La única definición de qué está cifrado. Es el contrato del anexo de
 * docs/esquema.md: si cambia una columna del schema, cambia acá.
 */
export const CAMPOS_CIFRADOS = {
  Paciente: {
    tabla: "pacientes",
    campos: { notas: campo("notasEncrypted", "notas_encrypted", "texto") },
  },
  Turno: {
    tabla: "turnos",
    campos: { notas: campo("notasEncrypted", "notas_encrypted", "texto") },
  },
  ConsentimientoGrabacion: {
    tabla: "consentimientos_grabacion",
    campos: {
      textoCompleto: campo("textoCompletoEncrypted", "texto_completo_encrypted", "texto"),
      firmaDigital: campo("firmaDigitalEncrypted", "firma_digital_encrypted", "texto"),
    },
  },
  HotWord: {
    tabla: "hot_words",
    campos: { termino: campo("terminoEncrypted", "termino_encrypted", "texto") },
  },
  SesionClinica: {
    tabla: "sesiones_clinicas",
    campos: {
      audioClave: campo("audioClaveEncrypted", "audio_clave_encrypted", "texto"),
      transcripcion: campo("transcripcionEncrypted", "transcripcion_encrypted", "texto"),
      notaIa: campo("notaIaEncrypted", "nota_ia_encrypted", "nota"),
      datos: campo("datosEncrypted", "datos_encrypted", "json"),
      feedback: campo("feedbackEncrypted", "feedback_encrypted", "json"),
      notaFinal: campo("notaFinalEncrypted", "nota_final_encrypted", "nota"),
      notasEdicion: campo("notasEdicionEncrypted", "notas_edicion_encrypted", "texto"),
    },
  },
  HiloVersion: {
    tabla: "hilo_versiones",
    campos: { contenido: campo("contenidoEncrypted", "contenido_encrypted", "json") },
  },
} as const satisfies Record<string, DefModelo>;

export type ModeloCifrado = keyof typeof CAMPOS_CIFRADOS;

export const MODELOS_CIFRADOS = Object.keys(CAMPOS_CIFRADOS) as ModeloCifrado[];

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

/** Prisma 5 entrega Buffer en Node; algunos entornos entregan Uint8Array. */
function aBuffer(valor: unknown): Buffer | null {
  if (valor == null) return null;
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) {
    return Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength);
  }
  return null;
}

/** Cualquier objeto → las 4 claves SOAP (extras se descartan, faltantes → null). */
export function normalizarNotaSoap(valor: unknown): NotaSoap | null {
  if (!esObjetoPlano(valor)) return null;
  return {
    subjetivo: textoONull(valor.subjetivo),
    objetivo: textoONull(valor.objetivo),
    analisis: textoONull(valor.analisis),
    plan: textoONull(valor.plan),
  };
}

function definicion(modelo: ModeloCifrado): DefModelo {
  return CAMPOS_CIFRADOS[modelo];
}

function aadCelda(modelo: ModeloCifrado, def: DefCampo, id: string): string {
  return aadDe(definicion(modelo).tabla, def.columnaSql, id);
}

function exigirId(modelo: ModeloCifrado, id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      `cifrar${modelo}: el id de la fila es obligatorio y tiene que existir ` +
        `antes del create (usar crypto.randomUUID()).`,
    );
  }
  return id;
}

// ────────────────────────────────────────────────────────────────────────────
// Serialización por tipo
// ────────────────────────────────────────────────────────────────────────────

function serializar(def: DefCampo, valor: unknown): string | null {
  if (valor === null) return null;
  switch (def.tipo) {
    case "texto":
      if (typeof valor !== "string") {
        throw new Error(`${def.columna}: se esperaba string o null`);
      }
      return valor;
    case "json":
      return typeof valor === "string" ? valor : JSON.stringify(valor);
    case "nota": {
      const nota = normalizarNotaSoap(valor);
      return nota === null ? null : JSON.stringify(nota);
    }
  }
}

function deserializar(def: DefCampo, texto: string): unknown {
  switch (def.tipo) {
    case "texto":
      return texto;
    case "json":
      return JSON.parse(texto);
    case "nota":
      return normalizarNotaSoap(JSON.parse(texto));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Lectura (los campos calculados)
// ────────────────────────────────────────────────────────────────────────────

function leer(modelo: ModeloCifrado, nombre: string, id: unknown, blob: unknown): unknown {
  const buffer = aBuffer(blob);
  if (buffer === null) return null;
  const def = definicion(modelo).campos[nombre];
  const texto = descifrar(buffer, aadCelda(modelo, def, exigirId(modelo, id)));
  return deserializar(def, texto);
}

// ────────────────────────────────────────────────────────────────────────────
// Escritura (los cifrarX)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cuerpo común: campos lógicos → columnas cifradas, atadas a la fila `id`.
 * `undefined` no toca la columna; `null` la deja en NULL.
 */
function cifrarCampos(
  modelo: ModeloCifrado,
  idCrudo: unknown,
  campos: object,
): Record<string, Buffer | null | string> {
  const id = exigirId(modelo, idCrudo);
  const def = definicion(modelo);
  const columnas: Record<string, Buffer | null | string> = { id };
  for (const [nombre, valor] of Object.entries(campos)) {
    const defCampo = def.campos[nombre];
    if (!defCampo) {
      throw new Error(`cifrar${modelo}: "${nombre}" no es un campo cifrado`);
    }
    if (valor === undefined) continue;
    const texto = serializar(defCampo, valor);
    columnas[defCampo.columna] =
      texto === null ? null : cifrar(texto, aadCelda(modelo, defCampo, id));
  }
  return columnas;
}

type ConId = { id: string };

export type ColumnasCifradasPaciente = ConId &
  Pick<Prisma.PacienteUncheckedCreateInput, "notasEncrypted">;
export type ColumnasCifradasTurno = ConId &
  Pick<Prisma.TurnoUncheckedCreateInput, "notasEncrypted">;
export type ColumnasCifradasConsentimiento = ConId &
  Required<
    Pick<
      Prisma.ConsentimientoGrabacionUncheckedCreateInput,
      "textoCompletoEncrypted" | "firmaDigitalEncrypted"
    >
  >;
export type ColumnasCifradasHotWord = ConId &
  Required<Pick<Prisma.HotWordUncheckedCreateInput, "terminoEncrypted">>;
export type ColumnasCifradasSesion = ConId &
  Pick<
    Prisma.SesionClinicaUncheckedCreateInput,
    | "audioClaveEncrypted"
    | "transcripcionEncrypted"
    | "notaIaEncrypted"
    | "datosEncrypted"
    | "feedbackEncrypted"
    | "notaFinalEncrypted"
    | "notasEdicionEncrypted"
  >;
export type ColumnasCifradasHiloVersion = ConId &
  Required<Pick<Prisma.HiloVersionUncheckedCreateInput, "contenidoEncrypted">>;

export function cifrarPaciente(
  id: string,
  campos: Partial<CamposPaciente>,
): ColumnasCifradasPaciente {
  return cifrarCampos("Paciente", id, campos) as ColumnasCifradasPaciente;
}

export function cifrarTurno(
  id: string,
  campos: Partial<CamposTurno>,
): ColumnasCifradasTurno {
  return cifrarCampos("Turno", id, campos) as ColumnasCifradasTurno;
}

/** Los dos campos son obligatorios: un consentimiento sin texto o sin firma
 *  no es un consentimiento (las columnas son NOT NULL). */
export function cifrarConsentimiento(
  id: string,
  campos: CamposConsentimiento,
): ColumnasCifradasConsentimiento {
  return cifrarCampos(
    "ConsentimientoGrabacion",
    id,
    campos,
  ) as ColumnasCifradasConsentimiento;
}

export function cifrarHotWord(
  id: string,
  campos: CamposHotWord,
): ColumnasCifradasHotWord {
  return cifrarCampos("HotWord", id, campos) as ColumnasCifradasHotWord;
}

export function cifrarSesion(
  id: string,
  campos: Partial<CamposSesionClinica>,
): ColumnasCifradasSesion {
  return cifrarCampos("SesionClinica", id, campos) as ColumnasCifradasSesion;
}

export function cifrarHiloVersion(
  id: string,
  campos: CamposHiloVersion,
): ColumnasCifradasHiloVersion {
  return cifrarCampos("HiloVersion", id, campos) as ColumnasCifradasHiloVersion;
}

// ────────────────────────────────────────────────────────────────────────────
// Guarda 1: nada cifrado en where / orderBy
// ────────────────────────────────────────────────────────────────────────────

const NO_CONSULTABLES = new Map<ModeloCifrado, ReadonlySet<string>>(
  MODELOS_CIFRADOS.map((modelo) => {
    const def = definicion(modelo);
    return [
      modelo,
      new Set<string>([
        ...Object.keys(def.campos),
        ...Object.values(def.campos).map((c) => c.columna),
      ]),
    ];
  }),
);

function noConsultables(modelo: ModeloCifrado): ReadonlySet<string> {
  return NO_CONSULTABLES.get(modelo) ?? new Set();
}

function rechazar(modelo: string, campo: string, uso: "filter" | "order"): never {
  throw new Error(
    `Cannot ${uso} ${modelo} by encrypted field ${campo}. ` +
      `Use a non-encrypted column instead.`,
  );
}

function validarWhere(modelo: ModeloCifrado, where: unknown): void {
  if (!esObjetoPlano(where)) return;
  for (const [clave, valor] of Object.entries(where)) {
    if (noConsultables(modelo).has(clave)) rechazar(modelo, clave, "filter");
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
    if (noConsultables(modelo).has(clave)) rechazar(modelo, clave, "order");
  }
}

/**
 * Lanza si los args filtran u ordenan por un campo lógico o una columna
 * cifrada. Exportada para testearla sin pasar por Prisma.
 */
export function assertConsultaSinCifrados(modelo: ModeloCifrado, args: unknown): void {
  if (!esObjetoPlano(args)) return;
  validarWhere(modelo, args.where);
  validarOrderBy(modelo, args.orderBy);
}

// ────────────────────────────────────────────────────────────────────────────
// Guarda 2: toda columna cifrada que se escribe va con el id de su fila y
// descifra con el AAD de esa fila
// ────────────────────────────────────────────────────────────────────────────

const OPERACIONES_DE_ESCRITURA = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
]);

/** Columnas cifradas presentes en `data` con un blob (no null, no undefined). */
function blobsEn(modelo: ModeloCifrado, data: unknown): Array<[DefCampo, Buffer]> {
  if (!esObjetoPlano(data)) return [];
  const out: Array<[DefCampo, Buffer]> = [];
  for (const def of Object.values(definicion(modelo).campos)) {
    const valor = data[def.columna];
    if (valor === undefined || valor === null) continue;
    const buffer = aBuffer(valor);
    if (buffer === null) {
      throw new Error(
        `${modelo}.${def.columna}: solo acepta un blob de cifrar${modelo} (o null)`,
      );
    }
    out.push([def, buffer]);
  }
  return out;
}

function verificarBlobs(
  modelo: ModeloCifrado,
  data: unknown,
  id: unknown,
  origenDelId: string,
): void {
  const blobs = blobsEn(modelo, data);
  if (blobs.length === 0) return;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      `${modelo}: escribir una columna cifrada exige ${origenDelId} (string). ` +
        `Usá cifrar${modelo}(id, …) y ponelo en data: { ...cifrar${modelo}(id, …) }.`,
    );
  }
  for (const [def, blob] of blobs) {
    try {
      descifrar(blob, aadCelda(modelo, def, id));
    } catch (error) {
      if (error instanceof ErrorDescifrado) {
        throw new Error(
          `${modelo}.${def.columna}: el blob no fue cifrado para la fila ${id} ` +
            `(${error.codigo}). Cifrá con cifrar${modelo}(id, …) usando el id de ESA fila.`,
        );
      }
      throw error;
    }
  }
}

/** El AAD incluye el id: cambiarlo deja ilegibles incluso las columnas que
 * esta operación no reescribe. cifrarX devuelve el mismo id y sigue permitido. */
function verificarIdInvariable(modelo: ModeloCifrado, data: unknown, where: Raw): void {
  if (!esObjetoPlano(data) || data.id === undefined) return;
  const id = esObjetoPlano(data.id) ? data.id.set : data.id;
  if (typeof where.id !== "string" || id !== where.id) {
    throw new Error(`${modelo}: no se puede cambiar el id de una fila con campos cifrados; exige where.id y el mismo data.id.`);
  }
}

/**
 * Lanza si una escritura lleva columnas cifradas sin el id de la fila o con
 * blobs que no descifran con el AAD de esa fila. Exportada para testearla
 * sin pasar por Prisma.
 */
export function assertEscrituraCifradaConsistente(
  modelo: ModeloCifrado,
  operacion: string,
  args: unknown,
): void {
  if (!OPERACIONES_DE_ESCRITURA.has(operacion) || !esObjetoPlano(args)) return;

  switch (operacion) {
    case "create":
      verificarBlobs(modelo, args.data, esObjetoPlano(args.data) ? args.data.id : undefined, "data.id");
      return;
    case "createMany":
    case "createManyAndReturn": {
      const filas = Array.isArray(args.data) ? args.data : [args.data];
      for (const fila of filas) {
        verificarBlobs(modelo, fila, esObjetoPlano(fila) ? fila.id : undefined, "data.id");
      }
      return;
    }
    case "update":
    case "updateMany": {
      const where = esObjetoPlano(args.where) ? args.where : {};
      verificarIdInvariable(modelo, args.data, where);
      verificarBlobs(modelo, args.data, where.id, "where.id");
      return;
    }
    case "upsert": {
      const where = esObjetoPlano(args.where) ? args.where : {};
      verificarIdInvariable(modelo, args.update, where);
      verificarBlobs(modelo, args.create, esObjetoPlano(args.create) ? args.create.id : undefined, "create.id");
      verificarBlobs(modelo, args.update, where.id, "where.id");
      return;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// La extensión
// ────────────────────────────────────────────────────────────────────────────

// Solo relaciones reales. Nunca interpretar un JSON de negocio o un blob como
// si fuera un árbol de operaciones Prisma. No hay una segunda copia del schema.
const RELACIONES = new Map(Prisma.dmmf.datamodel.models.map((modelo) => [
  modelo.name,
  modelo.fields.filter((campo) => campo.kind === "object"),
]));

function esModeloCifrado(modelo: string): modelo is ModeloCifrado {
  return Object.hasOwn(CAMPOS_CIFRADOS, modelo);
}

function validarAnidadas(modelo: string, data: unknown): void {
  if (Array.isArray(data)) {
    for (const fila of data) validarAnidadas(modelo, fila);
    return;
  }
  if (!esObjetoPlano(data)) return;
  for (const relacion of RELACIONES.get(modelo) ?? []) {
    const operaciones = data[relacion.name];
    if (!esObjetoPlano(operaciones)) continue;
    for (const [operacion, valor] of Object.entries(operaciones)) {
      for (const entrada of Array.isArray(valor) ? valor : [valor]) {
        if (!esObjetoPlano(entrada)) continue;
        if (operacion === "create") {
          validarOperacion(relacion.type, "create", { data: entrada });
        } else if (operacion === "connectOrCreate") {
          validarOperacion(relacion.type, "create", { where: entrada.where, data: entrada.create });
        } else if (operacion === "update" && !relacion.isList && !Object.hasOwn(entrada, "data")) {
          // Prisma admite la forma abreviada singular. Si escribe cifrado,
          // la guarda la rechaza por no poder demostrar where.id.
          validarOperacion(relacion.type, "update", { data: entrada });
        } else if (OPERACIONES_DE_ESCRITURA.has(operacion)) {
          validarOperacion(relacion.type, operacion, entrada);
        }
      }
    }
  }
}

function validarOperacion(modelo: string, operacion: string, args: unknown): void {
  if (esModeloCifrado(modelo)) {
    assertConsultaSinCifrados(modelo, args);
    assertEscrituraCifradaConsistente(modelo, operacion, args);
  }
  if (!OPERACIONES_DE_ESCRITURA.has(operacion) || !esObjetoPlano(args)) return;
  if (operacion === "upsert") {
    validarAnidadas(modelo, args.create);
    validarAnidadas(modelo, args.update);
  } else {
    validarAnidadas(modelo, args.data);
  }
}

export function withEncryption<C extends PrismaClient>(client: C) {
  validarLlavero();

  return client.$extends({
    name: "cifrado-en-reposo",
    result: {
      paciente: {
        notas: {
          needs: { id: true, notasEncrypted: true },
          compute: (f) => leer("Paciente", "notas", f.id, f.notasEncrypted) as string | null,
        },
      },
      turno: {
        notas: {
          needs: { id: true, notasEncrypted: true },
          compute: (f) => leer("Turno", "notas", f.id, f.notasEncrypted) as string | null,
        },
      },
      consentimientoGrabacion: {
        textoCompleto: {
          needs: { id: true, textoCompletoEncrypted: true },
          compute: (f) =>
            leer("ConsentimientoGrabacion", "textoCompleto", f.id, f.textoCompletoEncrypted) as string,
        },
        firmaDigital: {
          needs: { id: true, firmaDigitalEncrypted: true },
          compute: (f) =>
            leer("ConsentimientoGrabacion", "firmaDigital", f.id, f.firmaDigitalEncrypted) as string,
        },
      },
      hotWord: {
        termino: {
          needs: { id: true, terminoEncrypted: true },
          compute: (f) => leer("HotWord", "termino", f.id, f.terminoEncrypted) as string,
        },
      },
      sesionClinica: {
        audioClave: {
          needs: { id: true, audioClaveEncrypted: true },
          compute: (f) => leer("SesionClinica", "audioClave", f.id, f.audioClaveEncrypted) as string | null,
        },
        transcripcion: {
          needs: { id: true, transcripcionEncrypted: true },
          compute: (f) => leer("SesionClinica", "transcripcion", f.id, f.transcripcionEncrypted) as string | null,
        },
        notaIa: {
          needs: { id: true, notaIaEncrypted: true },
          compute: (f) => leer("SesionClinica", "notaIa", f.id, f.notaIaEncrypted) as NotaSoap | null,
        },
        datos: {
          needs: { id: true, datosEncrypted: true },
          compute: (f) => leer("SesionClinica", "datos", f.id, f.datosEncrypted),
        },
        feedback: {
          needs: { id: true, feedbackEncrypted: true },
          compute: (f) => leer("SesionClinica", "feedback", f.id, f.feedbackEncrypted),
        },
        notaFinal: {
          needs: { id: true, notaFinalEncrypted: true },
          compute: (f) => leer("SesionClinica", "notaFinal", f.id, f.notaFinalEncrypted) as NotaSoap | null,
        },
        notasEdicion: {
          needs: { id: true, notasEdicionEncrypted: true },
          compute: (f) => leer("SesionClinica", "notasEdicion", f.id, f.notasEdicionEncrypted) as string | null,
        },
      },
      hiloVersion: {
        contenido: {
          needs: { id: true, contenidoEncrypted: true },
          compute: (f) => leer("HiloVersion", "contenido", f.id, f.contenidoEncrypted),
        },
      },
    },
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          validarOperacion(model, operation, args);
          return query(args);
        },
      },
    },
  });
}

export type ClienteCifrado = ReturnType<typeof withEncryption<PrismaClient>>;
