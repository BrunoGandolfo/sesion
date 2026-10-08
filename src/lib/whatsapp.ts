// El enlace de WhatsApp asistido: https://wa.me/<número>?text=<mensaje>.
// Módulo PURO (sin base ni process.env), como src/lib/sms/texto.ts: el texto
// lo arma textoDelEnvio, el mismo que manda el SMS; acá sólo se empaqueta.
//
// wa.me quiere el número internacional en dígitos, sin "+", espacios ni
// guiones. El teléfono de la paciente ya es E.164 (se valida al escribirla),
// pero se dejan sólo los dígitos por las dudas. El texto va con
// encodeURIComponent: acentos en UTF-8 y saltos de línea como %0A, que es lo
// que WhatsApp espera.

/** El enlace, o null si no hay teléfono del que sacar un número. */
export function enlaceWhatsapp(telefono: string, texto: string): string | null {
  const numero = telefono.replace(/\D/g, "");
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
