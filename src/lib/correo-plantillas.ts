import {
  CORREO_RECUPERAR_ASUNTO, CORREO_RECUPERAR_TEXTO, CORREO_RECUPERAR_BOTON,
  CORREO_RECUPERAR_VENCE, CORREO_RECUPERAR_IGNORAR, CORREO_FIRMA,
} from "@/lib/glosario";
import type { Correo } from "@/lib/correo";

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[caracter]!);
}

/** HTML mínimo con los colores sage-500, cream-50 e ink-900 de globals.css. */
export function plantillaRecuperar(enlace: string): Omit<Correo, "para"> {
  const url = new URL(enlace);
  if (url.protocol !== "https:") throw new Error("El enlace del correo debe usar HTTPS");
  const parrafos = [CORREO_RECUPERAR_TEXTO, CORREO_RECUPERAR_VENCE, CORREO_RECUPERAR_IGNORAR];
  return {
    asunto: CORREO_RECUPERAR_ASUNTO,
    texto: [parrafos[0], enlace, ...parrafos.slice(1), CORREO_FIRMA].join("\n\n"),
    html: `<!doctype html><html lang="es"><body style="background:#FAFAF6;color:#1A2628;font-family:Arial,sans-serif;padding:24px;line-height:1.6"><main style="max-width:520px;margin:auto"><h1>${escaparHtml(CORREO_RECUPERAR_ASUNTO)}</h1><p>${escaparHtml(parrafos[0])}</p><p><a style="color:#4F7A6A" href="${escaparHtml(enlace)}">${escaparHtml(CORREO_RECUPERAR_BOTON)}</a></p>${parrafos.slice(1).map((p) => `<p>${escaparHtml(p)}</p>`).join("")}<p>${escaparHtml(CORREO_FIRMA)}</p></main></body></html>`,
  };
}
