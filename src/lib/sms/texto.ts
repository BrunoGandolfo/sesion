// Texto de los SMS: plantillas, variables y conteo de segmentos. Módulo PURO
// (sin Twilio, sin process.env, sin base) para que lo pueda importar la UI
// ("use client") sin arrastrar el cliente de envío. Absorbe al viejo
// src/lib/sms-texto.ts.
//
// La fecha y la hora se resuelven SIEMPRE en hora de Montevideo. El cron
// corre en Vercel, que va en UTC y no deja fijar TZ: el 4/9 un turno de las
// 15:15 salió anunciado "a las 18:15". La paciente lee la hora de su
// consultorio, no la del centro de datos.
//
// EL TEXTO DEL SMS NO SE GUARDA (decisión del dueño). Se arma en el momento
// de mandar, con la plantilla vigente de la organización, y de él sólo
// queda `segmentos` en envios_sms para el conteo mensual.

import { LINEA_CONTACTO, PLANTILLA_CAMBIO_DE_HORARIO, REMITENTE_SMS, TEMPLATE_SMS_CON_DIRECCION, TEMPLATE_SMS_SUGERIDO } from "@/lib/glosario";
import {
  formatearFechaLargaMvd,
  formatearHoraMvd,
} from "@/lib/fechas-montevideo";

/** El encabezado identifica al consultorio; el contacto indica cómo llamar.
 *  Se preparan igual para la vista previa y para el envío. */
export { LINEA_CONTACTO } from "@/lib/glosario";

/** Plantilla sugerida, también usada como valor inicial del formulario.
 *  Los nombres propios pueden forzar UCS-2 aunque la plantilla use GSM-7. */
export { TEMPLATE_SMS_SUGERIDO } from "@/lib/glosario";

/**
 * Plantilla del aviso de CAMBIO DE HORARIO. No es configurable: cuando la
 * profesional mueve un turno cuyo recordatorio ya salió, la paciente tiene
 * que enterarse de que cambió, no recibir un segundo "te recordamos". Un
 * mensaje que dice "cambió" es lo que evita que se presente al horario
 * viejo; por eso el texto es fijo y lo dice después del remitente.
 */
export { PLANTILLA_CAMBIO_DE_HORARIO } from "@/lib/glosario";

export interface SmsTemplateData {
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
export function buildSmsMessage(
  template: string,
  data: SmsTemplateData,
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
  if (template.trim() === SUGERIDA_ANTERIOR) return TEMPLATE_SMS_SUGERIDO;
  if (template.replaceAll(CONTACTO_ANTERIOR, "").trim() === SUGERIDA_INICIAL) return TEMPLATE_SMS_CON_DIRECCION;
  // Reemplazar el contacto en su lugar preserva aclaraciones como «de 9 a
  // 17». El remitente se agrega sólo al principio, sin borrar menciones al
  // consultorio que formen parte de una oración del cuerpo.
  let preparada = template.trim().replaceAll(CONTACTO_ANTERIOR, LINEA_CONTACTO);
  if (!preparada.startsWith(REMITENTE_SMS)) preparada = `${REMITENTE_SMS}\n${preparada}`;
  if (!preparada.includes(LINEA_CONTACTO)) preparada = `${preparada.trimEnd()}\n${LINEA_CONTACTO}`;
  return preparada;
}

/** Los motivos de SMS que tienen plantilla acá (el de cobro vive en
 *  src/lib/deudas.ts y lo manda la pantalla de Cobros). */
export type MotivoConPlantilla = "recordatorio_turno" | "cambio_de_horario";

/**
 * El texto de un envío según su motivo: el recordatorio usa la plantilla de
 * la organización (con la línea de contacto asegurada); el cambio de horario
 * usa la plantilla fija.
 */
export function textoDelEnvio(
  motivo: MotivoConPlantilla,
  plantillaRecordatorio: string,
  data: SmsTemplateData,
): string {
  const plantilla =
    motivo === "cambio_de_horario"
      ? PLANTILLA_CAMBIO_DE_HORARIO
      : prepararPlantillaRecordatorio(plantillaRecordatorio);
  return buildSmsMessage(plantilla, data);
}

// ---------------------------------------------------------------------------
// Conteo de longitud SMS (GSM 03.38 básico + extensión vs UCS-2)
// ---------------------------------------------------------------------------

// Alfabeto GSM 03.38 básico (1 septeto por carácter). Incluye é, ñ, ü, à, Ñ,
// pero NO í, ó, á, ú (esas fuerzan UCS-2).
const GSM7_BASICO =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// Extensión GSM 03.38 (escape + carácter → 2 septetos).
const GSM7_EXTENSION = "\f^{}\\[~]|€";

const GSM7_SIMPLE = 160;
const GSM7_CONCATENADO = 153;
const UCS2_SIMPLE = 70;
const UCS2_CONCATENADO = 67;

export interface LongitudSms {
  /** Unidades cobradas: septetos en GSM-7 (extensión cuenta 2) o code units
   *  UTF-16 en UCS-2. */
  caracteres: number;
  segmentos: number;
  gsm7: boolean;
}

export function contarLongitudSms(texto: string): LongitudSms {
  let septetos = 0;
  let gsm7 = true;

  for (const ch of texto) {
    if (GSM7_BASICO.includes(ch)) {
      septetos += 1;
    } else if (GSM7_EXTENSION.includes(ch)) {
      septetos += 2;
    } else {
      gsm7 = false;
      break;
    }
  }

  if (gsm7) {
    const segmentos =
      septetos === 0
        ? 0
        : septetos <= GSM7_SIMPLE
          ? 1
          : Math.ceil(septetos / GSM7_CONCATENADO);
    return { caracteres: septetos, segmentos, gsm7: true };
  }

  // UCS-2: cada code unit UTF-16 ocupa 2 bytes; los emoji (pares sustitutos)
  // cuentan doble, igual que en Twilio.
  const unidades = texto.length;
  const segmentos =
    unidades === 0
      ? 0
      : unidades <= UCS2_SIMPLE
        ? 1
        : Math.ceil(unidades / UCS2_CONCATENADO);
  return { caracteres: unidades, segmentos, gsm7: false };
}
