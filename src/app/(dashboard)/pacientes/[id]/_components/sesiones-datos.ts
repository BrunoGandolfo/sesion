// Lectura de la pestaña Sesiones: lo que viaja desde
// GET /api/pacientes/[id]/documentacion, cómo se funden las páginas y cómo se
// agrupa la lista por mes. Sin estado, sin efectos, sin React.

import { formatearMesMvd, mesIsoMvd } from "@/lib/fechas-montevideo";
import { apiGet } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import {
  ESCRIBIENDO_NOTA,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  PARA_REVISAR,
} from "@/lib/glosario";
import type {
  DatosEstructurados,
  EstadoSesion,
  NotaSoap,
} from "@/lib/sesion-clinica/schema";
import type { EstadoProcesamiento, Modalidad, Turno } from "@/types/domain";

// Ítem de GET /api/pacientes/[id]/documentacion: la nota vigente (aprobada
// o de la IA) y el tablero parseado en el servidor; el feedback tal cual.
export type DocSesion = {
  sesionClinicaId: string;
  turnoId: string;
  fecha: string;
  duracionMin: number;
  duracionAudioSeg: number | null;
  modalidad: Modalidad;
  estado: Extract<EstadoSesion, "revision" | "aprobada">;
  nota: NotaSoap | null;
  datos: DatosEstructurados | null;
  feedback: unknown;
  aprobadaEn: string | null;
  procesadaEn: string | null;
};

export type DocResponse = {
  pacienteId: string;
  totalSesiones: number;
  sesiones: DocSesion[];
  page: number;
  totalPages: number;
};

const PAGE_SIZE = 10;

// Lista atada al paciente que la cargó: al cambiar el id, la anterior deja
// de aplicar por derivación, sin resetear estado dentro de un efecto.
export type ListaState = {
  pacienteId: string;
  docs: DocSesion[];
  totalPages: number;
  totalSesiones: number;
  page: number;
  loading: boolean;
  error: string | null;
};

export function listaInicial(pacienteId: string): ListaState {
  return {
    pacienteId,
    docs: [],
    totalPages: 0,
    totalSesiones: 0,
    page: 1,
    loading: true,
    error: null,
  };
}

function urlDocumentacion(pacienteId: string, page: number): string {
  return `/api/pacientes/${pacienteId}/documentacion?page=${page}&limit=${PAGE_SIZE}`;
}

/** Una página de la documentación de la paciente. */
export function leerDocumentacion(
  pacienteId: string,
  page: number,
  signal?: AbortSignal,
): Promise<DocResponse> {
  return apiGet<DocResponse>(urlDocumentacion(pacienteId, page), { signal });
}

/** La primera página, otra vez. Si ya había páginas cargadas con "Cargar
 *  más" (se vuelve a pedir cuando llega la nota de hoy), se funde con lo que
 *  había en vez de reemplazarlo: antes la lista volvía sola a diez y el mes
 *  que ella estaba leyendo desaparecía (forense 03, P3-21). */
export function conPrimeraPagina(
  prev: ListaState,
  data: DocResponse,
  pacienteId: string,
): ListaState {
  const conservar =
    prev.pacienteId === pacienteId && prev.page > 1
      ? prev.docs.filter(
          (doc) => !data.sesiones.some((nuevo) => nuevo.sesionClinicaId === doc.sesionClinicaId),
        )
      : [];
  return {
    pacienteId,
    docs: [...data.sesiones, ...conservar],
    totalPages: data.totalPages,
    totalSesiones: data.totalSesiones,
    page: conservar.length > 0 ? prev.page : 1,
    loading: false,
    error: null,
  };
}

/** La página `page` agregada al final. Una respuesta que llega con otra
 *  paciente en pantalla no se mezcla. Sin repetidos: si entró una nota nueva
 *  arriba, la primera de esta página es la última de la anterior. */
export function conPaginaSiguiente(
  prev: ListaState,
  data: DocResponse,
  pacienteId: string,
  page: number,
): ListaState {
  if (prev.pacienteId !== pacienteId) return prev;
  return {
    ...prev,
    docs: [
      ...prev.docs,
      ...data.sesiones.filter(
        (nuevo) => !prev.docs.some((doc) => doc.sesionClinicaId === nuevo.sesionClinicaId),
      ),
    ],
    page,
    totalPages: data.totalPages,
    totalSesiones: data.totalSesiones,
    loading: false,
  };
}

export function chipDeEstado(estado: EstadoProcesamiento): {
  variant: "sage" | "terracotta" | "gold" | "neutral";
  label: string;
} | null {
  switch (estado) {
    case "grabando":
      return { variant: "terracotta", label: "Grabando…" };
    case "subiendo":
    case "procesando":
      return { variant: "gold", label: ESCRIBIENDO_NOTA };
    case "revision":
      return { variant: "gold", label: PARA_REVISAR };
    case "aprobada":
      return { variant: "sage", label: NOTA_GUARDADA };
    case "fallida":
      return { variant: "terracotta", label: NOTA_NO_ESCRITA };
    default:
      return null;
  }
}

export function resumenCorto(datos: DatosEstructurados | null): string {
  return datos?.resumenSesion?.trim() ?? "";
}

/** Segunda línea de la fila cuando la nota no dejó resumen: los temas, con
 *  su nombre legible. Es lo que hay; no se rellena con texto inventado. */
export function temasDeLaSesion(datos: DatosEstructurados | null): string {
  const temas = datos?.temas ?? [];
  if (temas.length === 0) return "";
  return temas.map(formatearEtiqueta).filter(Boolean).join(" · ");
}

// ────────────────────────────────────────────────────────────────────────────
// Agrupación por mes
//
// Con 40 sesiones la lista plana es un scroll sin referencias: cada fila dice
// "lunes 4 de marzo" y no hay forma de saltar a un período. Agrupada por mes,
// el mes corriente queda abierto y los anteriores plegados, con su cuenta a
// la vista.
// ────────────────────────────────────────────────────────────────────────────

/** Lo que la lista muestra: una sesión con nota (viene de /documentacion) o
 *  el turno de hoy cuya sesión todavía no tiene nota —sin grabar, en proceso
 *  o fallida—, que /documentacion no trae. */
export type Fila =
  | { tipo: "nota"; clave: string; fecha: Date; doc: DocSesion }
  | { tipo: "hoy"; clave: string; fecha: Date; turno: Turno };

export type GrupoMes = { clave: string; titulo: string; filas: Fila[] };

function tituloDeMes(fecha: Date): string {
  const texto = formatearMesMvd(fecha, true);
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

/** Agrupa por mes conservando el orden en que vino la lista (la API la manda
 *  de la más reciente a la más vieja). */
export function agruparPorMes(filas: Fila[]): GrupoMes[] {
  const grupos: GrupoMes[] = [];
  for (const fila of filas) {
    const clave = mesIsoMvd(fila.fecha);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) {
      ultimo.filas.push(fila);
      continue;
    }
    grupos.push({ clave, titulo: tituloDeMes(fila.fecha), filas: [fila] });
  }
  return grupos;
}
