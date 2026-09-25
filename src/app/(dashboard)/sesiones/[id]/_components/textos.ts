// Textos de la pantalla de sesión.
//
// Regla: una palabra por concepto, y el concepto se nombra donde ya está
// nombrado — src/lib/glosario.ts. Este módulo ya no define ningún texto: el
// bloque "PENDIENTE DE MUDARSE A glosario.ts" se mudó y acá quedó el
// re-export, para que los componentes de la ruta sigan importando de un solo
// lugar.
//
// Propios de esta pantalla quedan SECCIONES_SOAP, que no es texto sino el
// puente entre el glosario y las claves de la nota, y los rótulos de hablante
// de la transcripción, que no se usan en ninguna otra.

import type { NotaSoap } from "@/lib/sesion-clinica/schema";

export {
  ALGO_FALLO,
  ALIANZA_TERAPEUTICA,
  APARECIO_POR_PRIMERA_VEZ,
  APROBADA,
  APROBANDO,
  APROBAR_MENSAJE,
  APROBAR_NOTA,
  APROBAR_TITULO,
  BORRADOR,
  BUSCAR_ANTERIOR,
  BUSCAR_BORRAR,
  BUSCAR_EN_TRANSCRIPCION,
  BUSCAR_MINIMO,
  BUSCAR_PLACEHOLDER,
  BUSCAR_SIGUIENTE,
  CAMBIOS_SIN_APROBAR_MENSAJE,
  CAMBIOS_SIN_APROBAR_TITULO,
  PIDIENDO_NUEVA_NOTA,
  VOLVER_A_ESCRIBIR,
  VOLVER_A_ESCRIBIR_MENSAJE,
  VOLVER_A_ESCRIBIR_TITULO,
  EDITAR,
  ELIMINANDO,
  ELIMINAR,
  ELIMINAR_MENSAJE,
  ELIMINAR_TITULO,
  EMOCIONES,
  ESCRIBIENDO_NOTA,
  ESTADO_EMOCIONAL_OBSERVADO,
  INDICE_NOTA,
  INTENSIDAD_EMOCIONAL,
  INTERVENCIONES,
  IR_IGUAL,
  LEER_PARA_VOS,
  MAS_DE_ESTA_SESION,
  NOTA_APROBADA_AVISO,
  NOTA_CLINICA,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  PARA_LA_PROXIMA,
  PARA_VOS,
  PARA_VOS_SIN_ANALISIS,
  PARA_VOS_SUBTITULO,
  QUEDARME,
  REINTENTANDO,
  REINTENTAR,
  RESUMEN,
  SE_LLEVO,
  SELECTOR_VISTA_SESION,
  SIN_NOTA_TODAVIA,
  TEMAS,
  TRANSCRIPCION,
  TRANSCRIPCION_ABRIENDO,
  TRANSCRIPCION_ERROR_TITULO,
  TRANSCRIPCION_HABLANTES,
  TRANSCRIPCION_SIN_TEXTO,
  TRANSCRIPCION_SIN_TEXTO_TITULO,
  TRANSCRIPCION_SUBTITULO,
  VER_BORRADOR_ORIGINAL,
  VISTA_NOTA,
  VOLVER,
  VUELVE_A_APARECER,
  busquedaSinResultados,
  resultadoDeBusqueda,
} from "@/lib/glosario";

import {
  SOAP_A,
  SOAP_O,
  SOAP_P,
  SOAP_S,
} from "@/lib/glosario";

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

/**
 * Rótulos de hablante en la transcripción. El worker escribe "Terapeuta" y
 * "Paciente", pero ese reparto lo hace el reconocimiento de voz y se
 * equivoca (con una sola persona hablando llegó a rotular a las dos). En
 * pantalla no se afirma quién es quién: sólo que son dos voces distintas.
 * El texto guardado no cambia.
 */
export const HABLANTE_1 = "Hablante 1";
export const HABLANTE_2 = "Hablante 2";
