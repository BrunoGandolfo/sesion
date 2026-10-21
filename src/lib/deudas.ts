/**
 * Clasificación de antigüedad de deuda por zonas.
 * Color → token Tailwind del proyecto.
 *
 *   1–14 días  → sage       (#4F7A6A) — texto plano "hace X días"
 *  15–30 días  → gold/ocre  (#866929) — "hace X días ⚠"
 *   31+ días   → terracotta (#9A5C3B) — bold/badge
 *
 * El umbral 0 días (deudor de hoy mismo) cae en sage.
 */
export type ZonaDeuda = "sage" | "gold" | "terracotta";

export function zonaDeuda(diasAtraso: number): ZonaDeuda {
  if (diasAtraso >= 31) return "terracotta";
  if (diasAtraso >= 15) return "gold";
  return "sage";
}

/** El texto vive en el glosario; se re-exporta para Cobros, que lo importa
 *  de acá junto con zonaDeuda. */
export { textoAtraso } from "@/lib/glosario";

import { money } from "@/lib/format";

/**
 * Template default del recordatorio de cobro. Es el texto que sale por SMS y
 * el que ella lee entero antes de confirmar el envío (ver cobros-view).
 * Placeholders soportados por interpolarTemplateCobro:
 *   {{nombre}}        — nombre del paciente
 *   {{sesiones}}      — texto inteligente "1 sesión pendiente" / "N sesiones pendientes"
 *                       (la versión por defecto de la plantilla incluye texto
 *                       redundante "sesión/es pendiente/s" después del placeholder
 *                       que el interpolador absorbe automáticamente).
 *   {{monto}}         — monto formateado en moneda
 *   {{profesional}}   — nombre de la profesional (firma)
 */
export { TEMPLATE_COBRO_DEFAULT } from "@/lib/glosario";

interface InterpolarTemplateCobroVars {
  nombre: string;
  sesiones: number;
  monto: string;
  profesional: string;
  /** Las de la plantilla de turno que no dependen de un turno. */
  apellido?: string;
  direccion?: string;
  telefonoConsultorio?: string;
}

/**
 * Interpola los placeholders del template de cobro. La plantilla por defecto
 * tiene "{{sesiones}} sesión/es pendiente/s": detectamos ese trozo y lo
 * reemplazamos completo por la forma correcta ("1 sesión pendiente" o
 * "N sesiones pendientes"). Si la plantilla no lo tiene, caemos a un
 * reemplazo simple del placeholder por el número.
 */
export function interpolarTemplateCobro(
  template: string,
  vars: InterpolarTemplateCobroVars,
): string {
  const n = vars.sesiones;
  const sesionesTexto =
    n === 1 ? "1 sesión pendiente" : `${n} sesiones pendientes`;

  // Cada valor se inserta con una función en vez de con un string: como
  // string, `$&`, `$\'` y `` $` `` son patrones de reemplazo y se expanden
  // en silencio. El nombre y la firma salen de campos que escribe la
  // profesional, y el mensaje lo lee una paciente: acá entra texto literal.
  const literal = (valor: string) => () => valor;

  return template
    .replace(
      /\{\{sesiones\}\}\s*sesión\/es\s+pendiente\/s/g,
      literal(sesionesTexto),
    )
    .replace(/\{\{sesiones\}\}/g, literal(String(n)))
    .replace(/\{\{nombre\}\}/g, literal(vars.nombre))
    .replace(/\{\{monto\}\}/g, literal(vars.monto))
    .replace(/\{\{profesional\}\}/g, literal(vars.profesional))
    .replace(/\{\{apellido\}\}/g, literal(vars.apellido ?? ""))
    .replace(/\{\{direccion\}\}/g, literal(vars.direccion ?? ""))
    .replace(/\{\{telefonoConsultorio\}\}/g, literal(vars.telefonoConsultorio ?? ""))
    .trim();
}

/** Lo que hace falta de la configuración para armar el aviso de cobro. */
export interface ConfiguracionDelCobro {
  templateCobro: string;
  nombreProfesional: string;
  direccion: string;
  /** El teléfono del consultorio (la columna conserva el nombre viejo). */
  whatsappOrigen: string;
}

/**
 * El texto del aviso de cobro con la plantilla de la organización. Es la
 * ÚNICA puerta: la usan el cron que manda el SMS (texto-de-cobro.ts), el
 * enlace de WhatsApp y la vista previa de Cobros, así lo que ella confirma
 * es lo que le llega a la paciente por cualquiera de los dos canales.
 */
export function textoDelCobro(
  configuracion: ConfiguracionDelCobro,
  paciente: { nombre: string; apellido: string },
  deuda: { sesiones: number; monto: number },
): string {
  return interpolarTemplateCobro(configuracion.templateCobro, {
    nombre: paciente.nombre,
    apellido: paciente.apellido,
    sesiones: deuda.sesiones,
    monto: money(deuda.monto),
    profesional: configuracion.nombreProfesional,
    direccion: configuracion.direccion,
    telefonoConsultorio: configuracion.whatsappOrigen,
  });
}
