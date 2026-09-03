// Texto de los recordatorios por SMS: template, variables y conteo de
// longitud. Módulo puro (sin Twilio, sin process.env) para que lo pueda
// importar la UI ("use client") sin arrastrar el cliente de envío.
import { format } from "date-fns";
import { es } from "date-fns/locale";

/** Línea de contacto OBLIGATORIA por diseño: todo SMS termina indicando a
 *  quién y a qué número escribir para cambios. El cron la agrega si el
 *  template guardado por la usuaria no la contiene. */
export const LINEA_CONTACTO =
  "Para cambios, comunicate con {{profesional}} al {{telefonoConsultorio}}";

/** Template sugerido (es también el valor por defecto del formulario de
 *  configuración). Con datos realistas (Lucía / martes 21 de abril / 10:00 /
 *  Mariana Roldán / +598 99 876 543) rinde 133 caracteres. Como el español
 *  lleva tildes ("sesión", "Lucía", "Roldán") el mensaje viaja en UCS-2 →
 *  2 segmentos. Quitar las tildes del template no alcanza: los nombres
 *  propios las traen. */
export const TEMPLATE_SMS_SUGERIDO = `Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}. ${LINEA_CONTACTO}`;

export interface SmsTemplateData {
  nombre: string;
  apellido: string;
  fecha: Date;
  direccion: string;
  profesional: string;
  /** Teléfono del consultorio. Sale de Configuracion.whatsappOrigen (la
   *  columna conserva ese nombre hasta la próxima migración). */
  telefonoConsultorio?: string;
}

export function buildSmsMessage(
  template: string,
  data: SmsTemplateData,
): string {
  const fechaFmt = format(data.fecha, "EEEE d 'de' MMMM", { locale: es });
  const horaFmt = format(data.fecha, "HH:mm");

  return template
    .replaceAll("{{nombre}}", data.nombre)
    .replaceAll("{{apellido}}", data.apellido)
    .replaceAll("{{fecha}}", fechaFmt)
    .replaceAll("{{hora}}", horaFmt)
    .replaceAll("{{direccion}}", data.direccion)
    .replaceAll("{{profesional}}", data.profesional)
    .replaceAll("{{telefonoConsultorio}}", data.telefonoConsultorio ?? "");
}

/** Garantiza que el template termine con la línea de contacto obligatoria.
 *  Si ya la contiene, lo devuelve tal cual. */
export function asegurarLineaContacto(template: string): string {
  if (template.includes(LINEA_CONTACTO)) return template;
  const base = template.trimEnd();
  return base.length === 0 ? LINEA_CONTACTO : `${base}\n${LINEA_CONTACTO}`;
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
