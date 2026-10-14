// El material clínico que Lux lee de UN paciente, armado por el servidor.
//
// El modelo nunca elige qué se lee: este archivo decide, con la organización
// y el paciente que vienen de la sesión autenticada y de la ruta, y lo único
// que Lux puede pedir después es una transcripción de la lista (f) que arma
// este mismo archivo (herramientas.ts).
//
// ORDEN (el del prompt, documentos arriba y pregunta abajo, como pide la guía
// de contexto largo de Anthropic; cada documento con <source> y <fecha>):
//   a. Ficha mínima: nombre de pila, alta, sesiones aprobadas, orientación.
//      El esquema no tiene fecha de nacimiento: la edad no va.
//   b. Recorrido vigente completo y, si hay, la propuesta abierta, marcada
//      como "propuesta no aceptada".
//   c. Todas las notas aprobadas, de la más vieja a la más nueva, con el
//      núcleo de "Para vos" si está listo (sin scores).
//   d. Las dos transcripciones más recientes de sesiones aprobadas, completas.
//      Si con las dos el material pasa de ~90.000 tokens estimados
//      (caracteres / 4), va sólo la más reciente; si con una sola también,
//      ninguna. Lo omitido se dice en el material. Se mide el material
//      entero ya serializado (escape, envoltorios, avisos y lista (f)).
//   e. Las transcripciones que Lux ya leyó en ESTA conversación: cada línea
//      de estado "(mirando la transcripción del DD/MM)" —con la marca del
//      servidor, MARCA_ESTADO_LUX— de sus turnos en el historial
//      trae de vuelta esa transcripción, como documento propio ("leída en
//      esta conversación"). El historial es texto: sin esto, en la pregunta
//      siguiente Lux veía sus propias citas sin la fuente delante y decía
//      que las había inventado (prueba real del 9/10/2026). La fecha se
//      resuelve contra las sesiones aprobadas de este paciente (si hay dos
//      del mismo DD/MM en años distintos, entran las dos); una que no
//      corresponde a ninguna se ignora; una que ya está en (d) no se repite.
//      Entran mientras el material no pase el tope; las que no, se nombran
//      como omitidas y siguen en la lista (f) para reabrirlas.
//   f. Las demás sesiones aprobadas: id, fecha y primera línea de la nota.
//
// AUDITORÍA. Cada transcripción que entra al material deja su
// sesion.ver_transcripcion (via "lux") con `auditar`, en la MISMA transacción
// que la lee: sin rastro, no sale (la ruta contesta 500). Una transcripción
// que se lee para medirla y queda afuera no se audita: no llega al modelo.
//
// Todo lo que viene de la base va escapado (&, <, >): el texto de una
// transcripción no puede cerrar un <document> ni abrir uno falso.

import type { db } from "@/lib/db";
import { fechaInputMvd } from "@/lib/fechas-montevideo";
import type { ContenidoHilo, VersionHilo } from "@/lib/hilo/contenido";
import { LINEA_AVISO_MIRANDO, type TurnoHistorialLux } from "@/lib/lux/contrato";

import { requirePaciente } from "../../pacientes";
import { whereAprobadasDe, type IdentidadHilo } from "../hilo/base";
import { leerRecorrido } from "../hilo/leer";
import { auditarLecturaTranscripcion } from "../sesion/ver-transcripcion";

export type ClienteLux = typeof db;

/** Tope del material, en tokens estimados (caracteres / 4). Debajo de los
 *  100.000 a partir de los cuales Haiku cobra la entrada más cara. */
export const TOKENS_MAX_MATERIAL = 90_000;
export const CARACTERES_POR_TOKEN = 4;
/** Cuántas transcripciones completas van de entrada. */
export const TRANSCRIPCIONES_EN_MATERIAL = 2;

export interface MaterialLux {
  /** Los documentos, listos para el bloque del system prompt. */
  texto: string;
  /** Lo que leer_transcripcion puede abrir: id → fecha del turno. */
  abribles: ReadonlyMap<string, Date>;
  notas: number;
  /** Ids cuya transcripción entró completa (y quedó auditada). */
  transcripciones: string[];
  /** Cuántas de las más recientes quedaron afuera por tamaño. */
  transcripcionesOmitidas: number;
  /** Ids de las que volvieron porque Lux ya las había leído en la charla
   *  (y quedaron auditadas otra vez). */
  releidas: string[];
  /** Cuántas de esas no entraron por tamaño. */
  releidasOmitidas: number;
  /** Lo que queda del tope del material (TOKENS_MAX_MATERIAL), en caracteres,
   *  para lo que lea leer_transcripcion en esta respuesta: material y
   *  lecturas comparten un solo presupuesto. */
  caracteresLibres: number;
}

export interface ArmarMaterialInput extends IdentidadHilo {
  prisma: ClienteLux;
  usuarioId: string;
  /** "DD/MM" de las transcripciones que Lux ya leyó en esta conversación
   *  (leidasEnHistorial). */
  leidasEnConversacion?: readonly string[];
}

/** Los "DD/MM" de las líneas de estado "(mirando la transcripción del
 *  DD/MM)" que hay en los turnos de Lux del historial, sin repetir y en el
 *  orden en que aparecen. Sólo cuentan las que llevan la marca del servidor
 *  (LINEA_AVISO_MIRANDO): la misma frase escrita por el modelo sale sin
 *  marca y no es una lectura. Los turnos de ella tampoco cuentan. */
export function leidasEnHistorial(historial: readonly TurnoHistorialLux[]): string[] {
  const fechas = new Set<string>();
  for (const turno of historial) {
    if (turno.rol !== "asistente") continue;
    for (const linea of turno.texto.split("\n")) {
      const aviso = LINEA_AVISO_MIRANDO.exec(linea);
      if (!aviso) continue;
      const [dia, mes] = aviso[1].split("/");
      fechas.add(`${dia.padStart(2, "0")}/${mes.padStart(2, "0")}`);
    }
  }
  return [...fechas];
}

export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN);
}

export function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "AAAA-MM-DD" de Montevideo → "DD/MM/AAAA". */
export function fechaLegible(instante: Date): string {
  const [anio, mes, dia] = fechaInputMvd(instante).split("-");
  return `${dia}/${mes}/${anio}`;
}

/** "DD/MM", para el aviso de la herramienta. */
export function diaMes(instante: Date): string {
  return fechaLegible(instante).slice(0, 5);
}

function documento(indice: number, fuente: string, fecha: string | null, contenido: string): string {
  return [
    `<document index="${indice}">`,
    `<source>${escapar(fuente)}</source>`,
    ...(fecha ? [`<fecha>${fecha}</fecha>`] : []),
    "<document_content>",
    escapar(contenido.trim()),
    "</document_content>",
    "</document>",
  ].join("\n");
}

const ORIENTACIONES: Record<string, string> = {
  gestalt: "gestáltica",
  cbt_mi: "cognitivo-conductual con entrevista motivacional",
};

function textoRecorrido(contenido: ContenidoHilo, fechas: ReadonlyMap<string, Date>): string {
  const fechaDe = (id: string) => (fechas.has(id) ? fechaLegible(fechas.get(id)!) : "sesión no aprobada o borrada");
  const lineas: string[] = [];
  lineas.push(`Hipótesis de trabajo: ${contenido.hipotesisDiagnostica ?? "(sin escribir)"}`);
  lineas.push(`Resumen acumulativo: ${contenido.resumenAcumulativo ?? "(sin escribir)"}`);
  lineas.push("Objetivos terapéuticos:");
  for (const o of contenido.objetivosTerapeuticos) {
    lineas.push(`- ${o.descripcion} (${o.estado}, desde ${o.fechaInicio}${o.fechaCierre ? `, cerrado ${o.fechaCierre}` : ""})`);
  }
  lineas.push("Intervenciones probadas:");
  for (const i of contenido.intervencionesProbadas) {
    lineas.push(`- ${i.tecnica}, eficacia percibida ${i.eficaciaPercibida}, en las sesiones del ${i.sesiones.map(fechaDe).join(", ")}`);
  }
  lineas.push("Temas recurrentes:");
  for (const t of contenido.temasRecurrentes) lineas.push(`- ${t.tema} (${t.conteo} veces)`);
  lineas.push("Riesgos históricos:");
  for (const r of contenido.riesgosHistoricos) lineas.push(`- ${r.fecha}, ${r.flag}: ${r.detalle}`);
  lineas.push("Cambios de esta versión:");
  for (const c of contenido.cambios) lineas.push(`- ${c}`);
  return lineas.join("\n");
}

/** La nota tal como sale de la base: un campo puede venir null. */
interface NotaSoapLeida { subjetivo: string | null; objetivo: string | null; analisis: string | null; plan: string | null }

function textoNota(nota: NotaSoapLeida | null): string {
  if (!nota) return "(la nota aprobada no tiene texto)";
  return [
    `Subjetivo: ${nota.subjetivo ?? ""}`,
    `Objetivo: ${nota.objetivo ?? ""}`,
    `Análisis: ${nota.analisis ?? ""}`,
    `Plan: ${nota.plan ?? ""}`,
  ].join("\n");
}

/** El núcleo panteórico de "Para vos", sin scores. El JSON viene de la base
 *  y puede ser legacy: se lee con cuidado y se omite lo que no tenga forma. */
function textoParaVos(feedback: unknown): string | null {
  if (!feedback || typeof feedback !== "object") return null;
  const f = feedback as Record<string, unknown>;
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor : []) as Record<string, unknown>[];
  const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
  const lineas: string[] = [];
  for (const fortaleza of lista(f.fortalezas)) {
    if (texto(fortaleza.descripcion)) lineas.push(`Fortaleza: ${texto(fortaleza.descripcion)}`);
  }
  for (const area of lista(f.areasCrecimiento)) {
    const partes = [texto(area.observacion), texto(area.sugerencia)].filter(Boolean);
    if (partes.length) lineas.push(`Área de crecimiento: ${partes.join(" Sugerencia: ")}`);
  }
  if (texto(f.sugerenciaProximaSesion)) lineas.push(`Sugerencia para la próxima sesión: ${texto(f.sugerenciaProximaSesion)}`);
  return lineas.length ? lineas.join("\n") : null;
}

function primeraLinea(nota: NotaSoapLeida | null): string {
  const linea = (nota?.subjetivo ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "(sin texto)";
  return linea.length > 160 ? `${linea.slice(0, 157)}…` : linea;
}

export async function armarMaterial(input: ArmarMaterialInput): Promise<MaterialLux> {
  const { prisma, organizationId, pacienteId, usuarioId } = input;
  const identidad = { organizationId, pacienteId };

  const paciente = await requirePaciente(prisma, pacienteId, organizationId, { nombre: true, creadoEn: true });
  const configuracion = await prisma.configuracion.findUnique({
    where: { organizationId }, select: { orientacionTeorica: true },
  });
  const recorrido = await leerRecorrido(prisma, identidad);
  const aprobadas = await prisma.sesionClinica.findMany({
    where: whereAprobadasDe(identidad),
    select: {
      id: true, notaFinal: true, feedbackEstado: true, feedback: true,
      turno: { select: { fecha: true } },
    },
    orderBy: [{ turno: { fecha: "asc" } }, { id: "asc" }],
  });
  const fechas = new Map(aprobadas.map((s) => [s.id, s.turno.fecha]));
  // Las candidatas a transcripción completa: las más recientes, la más nueva primero.
  const candidatas = aprobadas.slice(-TRANSCRIPCIONES_EN_MATERIAL).reverse();

  // Las partes van como [fuente, fecha, contenido]; el índice y el escape se
  // ponen al serializar, que es lo que se mide contra el tope.
  type Parte = [string, Date | null, string];
  const fijas: Parte[] = [];
  const agregar = (fuente: string, fecha: Date | null, contenido: string) => { fijas.push([fuente, fecha, contenido]); };

  agregar("Ficha del paciente", null, [
    `Nombre de pila: ${paciente.nombre}`,
    `En Sesión desde: ${fechaLegible(paciente.creadoEn)}`,
    `Sesiones con nota aprobada: ${aprobadas.length}`,
    `Orientación del consultorio: ${ORIENTACIONES[configuracion?.orientacionTeorica ?? "cbt_mi"] ?? configuracion?.orientacionTeorica}`,
  ].join("\n"));

  agregar(...documentoVersion("Recorrido vigente", recorrido.vigente, fechas));
  if (recorrido.propuesta) {
    agregar(...documentoVersion("Propuesta de Recorrido NO ACEPTADA por la profesional (lectura de la app, no validada)", recorrido.propuesta, fechas));
  }

  for (const sesion of aprobadas) {
    const paraVos = sesion.feedbackEstado === "listo" ? textoParaVos(sesion.feedback) : null;
    agregar(
      `Nota aprobada de la sesión del ${fechaLegible(sesion.turno.fecha)} (id ${sesion.id})`,
      sesion.turno.fecha,
      paraVos ? `${textoNota(sesion.notaFinal)}\n\n"Para vos" (devolución a la terapeuta):\n${paraVos}` : textoNota(sesion.notaFinal),
    );
  }

  const limite = TOKENS_MAX_MATERIAL * CARACTERES_POR_TOKEN;

  // Las que Lux ya leyó en esta conversación y no están entre las candidatas
  // de (d): de la más nueva a la más vieja, como las candidatas.
  const enBase = new Set(candidatas.map((s) => s.id));
  const pedidas = new Set(input.leidasEnConversacion ?? []);
  const releer = aprobadas.filter((s) => pedidas.has(diaMes(s.turno.fecha)) && !enBase.has(s.id)).reverse();

  interface ConTexto { id: string; fecha: Date; estado: string; transcripcion: string }
  interface Eleccion { incluidas: ConTexto[]; omitidas: ConTexto[]; releidas: ConTexto[]; releidasOmitidas: ConTexto[] }

  // El material entero, tal como viaja: fijas, (d), avisos, (e), avisos y
  // la lista (f). Cada decisión de qué entra se mide con esto.
  const componer = (e: Eleccion) => {
    const partes: Parte[] = [...fijas];
    // Más vieja primero, como las notas.
    for (const s of [...e.incluidas].reverse()) {
      partes.push([`Transcripción completa de la sesión del ${fechaLegible(s.fecha)} (id ${s.id}; S0 es la terapeuta)`, s.fecha, s.transcripcion]);
    }
    if (e.omitidas.length) {
      partes.push(["Aviso del sistema sobre el material", null, e.omitidas
        .map((s) => `Transcripción del ${fechaLegible(s.fecha)} omitida por tamaño.`).join("\n")]);
    }
    for (const s of [...e.releidas].reverse()) {
      partes.push([
        `Transcripción completa de la sesión del ${fechaLegible(s.fecha)}, leída en esta conversación (id ${s.id}; S0 es la terapeuta)`,
        s.fecha, s.transcripcion,
      ]);
    }
    if (e.releidasOmitidas.length) {
      partes.push(["Aviso del sistema sobre el material", null, e.releidasOmitidas
        .map((s) => `Transcripción del ${fechaLegible(s.fecha)}, leída en esta conversación, omitida por tamaño: podés volver a abrirla con leer_transcripcion.`)
        .join("\n")]);
    }
    const conTranscripcion = new Set([...e.incluidas, ...e.releidas].map((s) => s.id));
    const demas = aprobadas.filter((s) => !conTranscripcion.has(s.id));
    partes.push([
      "Sesiones anteriores que podés abrir con leer_transcripcion",
      null,
      demas.length
        ? demas.map((s) => `${s.id} · ${fechaLegible(s.turno.fecha)} · ${primeraLinea(s.notaFinal)}`).join("\n")
        : "(ninguna: no hay otras sesiones aprobadas)",
    ]);
    const documentos = partes.map(([fuente, fecha, contenido], i) =>
      documento(i + 1, fuente, fecha ? fechaInputMvd(fecha) : null, contenido));
    return { texto: `<documents>\n${documentos.join("\n")}\n</documents>`, demas };
  };

  // Lectura, decisión y rastro de las transcripciones en una transacción.
  const elegidas = await prisma.$transaction(async (tx) => {
    const leidas = await tx.sesionClinica.findMany({
      where: { id: { in: [...candidatas, ...releer].map((s) => s.id) }, ...whereAprobadasDe(identidad) },
      select: { id: true, estado: true, transcripcion: true },
    });
    const porId = new Map(leidas.map((s) => [s.id, s]));
    const conTextoDe = (lista: typeof candidatas): ConTexto[] => lista.flatMap((s) => {
      const fila = porId.get(s.id);
      return fila?.transcripcion ? [{ id: s.id, fecha: s.turno.fecha, estado: fila.estado, transcripcion: fila.transcripcion }] : [];
    });
    const entra = (e: Eleccion) => componer(e).texto.length <= limite;
    const conTexto = conTextoDe(candidatas);
    let incluidas = conTexto;
    while (incluidas.length && !entra({ incluidas, omitidas: conTexto.slice(incluidas.length), releidas: [], releidasOmitidas: [] })) {
      incluidas = incluidas.slice(0, -1);
    }
    const eleccion: Eleccion = { incluidas, omitidas: conTexto.slice(incluidas.length), releidas: [], releidasOmitidas: [] };
    const releerConTexto = conTextoDe(releer);
    for (const [n, s] of releerConTexto.entries()) {
      // Se mide con las que faltan decidir como omitidas: su aviso también viaja.
      const pendientes = releerConTexto.slice(n + 1);
      const conElla = { ...eleccion, releidas: [...eleccion.releidas, s], releidasOmitidas: [...eleccion.releidasOmitidas, ...pendientes] };
      if (entra(conElla)) eleccion.releidas.push(s);
      else eleccion.releidasOmitidas.push(s);
    }
    for (const s of [...eleccion.incluidas, ...eleccion.releidas]) {
      await auditarLecturaTranscripcion(tx, {
        organizationId, usuarioId, sesionId: s.id,
        estado: s.estado, caracteres: s.transcripcion.length, via: "lux",
      });
    }
    return eleccion;
  });

  const { texto, demas } = componer(elegidas);
  return {
    texto,
    caracteresLibres: Math.max(0, limite - texto.length),
    abribles: new Map(demas.map((s) => [s.id, s.turno.fecha])),
    notas: aprobadas.length,
    transcripciones: elegidas.incluidas.map((s) => s.id),
    transcripcionesOmitidas: elegidas.omitidas.length,
    releidas: elegidas.releidas.map((s) => s.id),
    releidasOmitidas: elegidas.releidasOmitidas.length,
  };
}

function documentoVersion(
  titulo: string, version: VersionHilo | null, fechas: ReadonlyMap<string, Date>,
): [string, Date | null, string] {
  if (!version) return [titulo, null, "(todavía no hay Recorrido para este paciente)"];
  const creada = new Date(version.creadaEn);
  return [`${titulo}, versión ${version.version}`, creada, textoRecorrido(version.contenido, fechas)];
}
