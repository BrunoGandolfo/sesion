// El texto de los avisos a la paciente (recordatorio, cambio de horario):
// plantillas y variables. Módulo PURO (sin process.env, sin base) para que
// lo pueda importar la UI ("use client"). Antes vivía en src/lib/sms/; el
// SMS ya no existe y el texto lo manda ella por WhatsApp.
//
// La fecha y la hora se resuelven SIEMPRE en hora de Montevideo. El servidor
// corre en Vercel, que va en UTC y no deja fijar TZ: el 4/9 un turno de las
// 15:15 salió anunciado "a las 18:15". La paciente lee la hora de su
// consultorio, no la del centro de datos.
//
// EL TEXTO NO SE GUARDA (decisión del dueño): se arma en el momento, con la
// plantilla vigente de la organización.

import { LINEA_CONTACTO, PLANTILLA_CAMBIO_DE_HORARIO, REMITENTE_AVISO, TEMPLATE_RECORDATORIO_CON_DIRECCION, TEMPLATE_RECORDATORIO_SUGERIDO } from "@/lib/glosario";
import {
  formatearFechaLargaMvd,
  formatearHoraMvd,
} from "@/lib/fechas-montevideo";

/** Plantilla sugerida, también usada como valor inicial del formulario. */
export { TEMPLATE_RECORDATORIO_SUGERIDO } from "@/lib/glosario";


interface DatosDelMensaje {
  nombre: string;
  apellido: string;
  fecha: Date;
  direccion: string;
  profesional: string;
  /** Teléfono del consultorio. Sale de Configuracion.whatsappOrigen (la
   *  columna conserva ese nombre). */
  telefonoConsultorio?: string;
}

/**
 * Reemplaza las variables de la plantilla. El reemplazo va con FUNCIÓN y no
 * con string: `String.prototype.replaceAll(patrón, texto)` interpreta `$&`,
 * `$1` y `$$` dentro del texto de reemplazo, así que una paciente llamada
 * "Ana $&" o una dirección con "$" salían mal. Con función, el valor entra
 * tal cual.
 */
export function armarMensaje(
  template: string,
  data: DatosDelMensaje,
): string {
  const valores: Record<string, string> = {
    nombre: data.nombre,
    apellido: data.apellido,
    fecha: formatearFechaLargaMvd(data.fecha),
    hora: formatearHoraMvd(data.fecha),
    direccion: data.direccion,
    profesional: data.profesional,
    telefonoConsultorio: data.telefonoConsultorio ?? "",
  };
  let out = template;
  for (const [clave, valor] of Object.entries(valores)) {
    out = out.replaceAll(`{{${clave}}}`, () => valor);
  }
  return out;
}

// Compatibilidad con plantillas ya guardadas: se reemplaza la firma vieja
// al preparar el texto, sin modificar la configuración ni duplicar el nombre.
const CONTACTO_ANTERIOR = "Para cambios, comunicate con {{profesional}} al {{telefonoConsultorio}}";
const SUGERIDA_ANTERIOR = `Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}. ${CONTACTO_ANTERIOR}`;
// Sigue siendo el default de la base. Se reconoce al leer, sin migrar filas.
const SUGERIDA_INICIAL = "Hola {{nombre}}. Te recordamos tu sesión:\n{{fecha}}  |  {{hora}}\n{{direccion}}\n\nCualquier cambio, avisame con anticipación. Gracias.";

/** Identifica al remitente en la primera línea y da un canal para cambios.
 *  Conserva el cuerpo personalizado; sólo actualiza la antigua sugerencia
 *  cuando coincide completa. No intenta reinterpretar texto libre. */
export function prepararPlantillaRecordatorio(template: string): string {
  if (template.trim() === SUGERIDA_ANTERIOR) return TEMPLATE_RECORDATORIO_SUGERIDO;
  if (template.replaceAll(CONTACTO_ANTERIOR, "").trim() === SUGERIDA_INICIAL) return TEMPLATE_RECORDATORIO_CON_DIRECCION;
  // Reemplazar el contacto en su lugar preserva aclaraciones como «de 9 a
  // 17». El remitente se agrega sólo al principio, sin borrar menciones al
  // consultorio que formen parte de una oración del cuerpo.
  let preparada = template.trim().replaceAll(CONTACTO_ANTERIOR, LINEA_CONTACTO);
  if (!preparada.startsWith(REMITENTE_AVISO)) preparada = `${REMITENTE_AVISO}\n${preparada}`;
  if (!preparada.includes(LINEA_CONTACTO)) preparada = `${preparada.trimEnd()}\n${LINEA_CONTACTO}`;
  return preparada;
}

/** Los avisos que tienen plantilla acá (el de cobro vive en
 *  src/lib/deudas.ts y lo manda la pantalla de Cobros). */
export type MotivoConPlantilla = "recordatorio_turno" | "cambio_de_horario";

/**
 * El texto de un aviso según su motivo: el recordatorio usa la plantilla de
 * la organización (con la línea de contacto asegurada); el cambio de horario
 * usa la plantilla fija.
 */
export function textoDelEnvio(
  motivo: MotivoConPlantilla,
  plantillaRecordatorio: string,
  data: DatosDelMensaje,
): string {
  const plantilla =
    motivo === "cambio_de_horario"
      ? PLANTILLA_CAMBIO_DE_HORARIO
      : prepararPlantillaRecordatorio(plantillaRecordatorio);
  return armarMensaje(plantilla, data);
}

/** Lo que hace falta de la configuración para armar un recordatorio. */
export interface ConfiguracionDelRecordatorio {
  templateRecordatorio: string;
  direccion: string;
  nombreProfesional: string;
  /** El teléfono del consultorio (la columna conserva el nombre viejo). */
  whatsappOrigen: string;
}

/**
 * El texto del recordatorio de un turno, con la configuración tal como
 * viene de la base. Es la ÚNICA puerta: la usa el WhatsApp asistido
 * (casos-uso/recordatorios-whatsapp.ts).
 */
export function textoDelRecordatorio(
  motivo: MotivoConPlantilla,
  configuracion: ConfiguracionDelRecordatorio,
  paciente: { nombre: string; apellido: string },
  fechaTurno: Date,
): string {
  return textoDelEnvio(motivo, configuracion.templateRecordatorio, {
    nombre: paciente.nombre,
    apellido: paciente.apellido,
    fecha: fechaTurno,
    direccion: configuracion.direccion,
    profesional: configuracion.nombreProfesional,
    telefonoConsultorio: configuracion.whatsappOrigen,
  });
}
