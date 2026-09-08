/**
 * Clasificación de antigüedad de deuda por zonas.
 * Color → token Tailwind del proyecto.
 *
 *   1–14 días  → sage       (#4F7A6A) — texto plano "hace X días"
 *  15–30 días  → gold/ocre  (#A88534) — "hace X días ⚠"
 *   31+ días   → terracotta (#B26B45) — bold/badge
 *
 * El umbral 0 días (deudor de hoy mismo) cae en sage.
 */
export type ZonaDeuda = "sage" | "gold" | "terracotta";

export function zonaDeuda(diasAtraso: number): ZonaDeuda {
  if (diasAtraso >= 31) return "terracotta";
  if (diasAtraso >= 15) return "gold";
  return "sage";
}

/** Texto humano: "hoy", "hace 1 día", "hace N días". */
export function textoAtraso(diasAtraso: number): string {
  if (diasAtraso <= 0) return "hoy";
  if (diasAtraso === 1) return "hace 1 día";
  return `hace ${diasAtraso} días`;
}

/**
 * Template default para el recordatorio de cobro por WhatsApp.
 * Placeholders soportados por interpolarTemplateCobro:
 *   {{nombre}}        — nombre del paciente
 *   {{sesiones}}      — texto inteligente "1 sesión pendiente" / "N sesiones pendientes"
 *                       (la versión por defecto de la plantilla incluye texto
 *                       redundante "sesión/es pendiente/s" después del placeholder
 *                       que el interpolador absorbe automáticamente).
 *   {{monto}}         — monto formateado en moneda
 *   {{profesional}}   — nombre de la profesional (firma)
 */
export const TEMPLATE_COBRO_DEFAULT =
  "Hola {{nombre}}, ¿cómo estás? Te escribo para recordarte que tenés {{sesiones}} sesión/es pendiente/s de pago por un total de {{monto}}. Cualquier duda estoy a disposición. {{profesional}}";

export interface InterpolarTemplateCobroVars {
  nombre: string;
  sesiones: number;
  monto: string;
  profesional: string;
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
    .trim();
}

/**
 * Construye una URL `wa.me` para abrir WhatsApp con un mensaje pre-armado.
 * El teléfono debe venir en formato E.164 (+598...). Quitamos el `+` y
 * cualquier separador no numérico para evitar URLs rotas.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const numero = phone.replace(/\+/g, "").replace(/\D/g, "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}
