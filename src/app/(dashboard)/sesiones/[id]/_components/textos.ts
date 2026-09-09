// Textos de la pantalla de sesión.
//
// Regla: una palabra por concepto, y el concepto se nombra donde ya está
// nombrado — src/lib/glosario.ts. Este módulo ya no define ningún texto: el
// bloque "PENDIENTE DE MUDARSE A glosario.ts" se mudó y acá quedó el
// re-export, para que los componentes de la ruta sigan importando de un solo
// lugar.
//
// Lo único propio es SECCIONES_SOAP, que no es texto sino el puente entre el
// glosario y las claves de la nota.

import type { NotaSoap } from "@/lib/sesion-clinica/schema";

export {
  ABRIENDO_NOTA,
  ALGO_FALLO,
  ALIANZA_TERAPEUTICA,
  APARECIO_POR_PRIMERA_VEZ,
  APROBADA,
  APROBANDO,
  APROBAR_MENSAJE,
  APROBAR_NOTA,
  APROBAR_TITULO,
  BORRADOR,
  CAMBIOS_SIN_APROBAR_MENSAJE,
  CAMBIOS_SIN_APROBAR_TITULO,
  CTSR,
  DESCARTANDO,
  DESCARTAR,
  DESCARTAR_MENSAJE,
  DESCARTAR_TITULO,
  EDITAR,
  ELIMINANDO,
  ELIMINAR,
  ELIMINAR_MENSAJE,
  ELIMINAR_TITULO,
  EMOCIONES,
  ESCRIBIENDO_NOTA,
  ESTADO_EMOCIONAL_OBSERVADO,
  FALTA_REVISAR_RIESGO,
  GTFS,
  INTENSIDAD_EMOCIONAL,
  INTERVENCIONES,
  IR_IGUAL,
  LEER_PARA_VOS,
  LO_QUE_DIJO,
  MAS_DE_ESTA_SESION,
  MITI,
  NOTA_APROBADA_AVISO,
  NOTA_CLINICA,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  PARA_LA_PROXIMA,
  PARA_REVISAR,
  PARA_VOS,
  PARA_VOS_SIN_ANALISIS,
  PARA_VOS_SUBTITULO,
  QUEDARME,
  REINTENTANDO,
  REINTENTAR,
  RESUMEN,
  REVISE_ESTA_SENAL,
  SE_LLEVO,
  SELECTOR_VISTA_SESION,
  SENAL_DE_RIESGO,
  SIN_NOTA_TODAVIA,
  TEMAS,
  VER_BORRADOR_ORIGINAL,
  VER_DETALLE,
  VISTA_NOTA,
  VOLVER,
  VUELVE_A_APARECER,
  pluralizar,
} from "@/lib/glosario";

import {
  APROBADA,
  BORRADOR,
  SOAP_A,
  SOAP_O,
  SOAP_P,
  SOAP_S,
} from "@/lib/glosario";

/** @deprecated Importar `BORRADOR` de "@/lib/glosario". */
export const CHIP_BORRADOR = BORRADOR;

/** @deprecated Importar `APROBADA` de "@/lib/glosario". */
export const CHIP_APROBADA = APROBADA;

/**
 * Las cuatro secciones SOAP con la clave de la nota que edita cada una.
 * glosario.SOAP_SECCIONES tiene el mismo orden pero no las claves: la nota
 * es un objeto, no una lista, y la pantalla necesita saber qué campo escribe
 * cada sección. Nombre y letra salen del glosario, sin excepción.
 */
export const SECCIONES_SOAP: ReadonlyArray<{
  clave: keyof NotaSoap;
  titulo: string;
  ayuda: string;
}> = [
  { clave: "subjetivo", ...SOAP_S },
  { clave: "objetivo", ...SOAP_O },
  { clave: "analisis", ...SOAP_A },
  { clave: "plan", ...SOAP_P },
];
