// Receptor de violaciones de la Content-Security-Policy.
//
// La política vive en src/lib/csp.ts y la emite el middleware en modo
// Report-Only: nada se bloquea, el navegador sólo avisa. Acá se recibe ese
// aviso y se lo deja en el log. Cómo se lee y cómo se recorta está en
// src/lib/csp-reportes.ts, que es donde se puede testear.
//
// AL LOG Y NO A eventos_auditoria, A PROPÓSITO
//
// `eventos_auditoria` es append-only, se conserva, y es donde vive el rastro
// clínico y de accesos. Estos reportes son ruido de diagnóstico de una etapa
// transitoria: los manda el navegador de cualquiera que abra la app, no
// llevan actor, y una extensión del navegador que inyecte un script puede
// generar cientos. Mezclarlos con el registro que un día puede terminar en
// un expediente sería contaminarlo. Van a `console.warn`, que en Vercel es
// el log de la función.
//
// ES UN ENDPOINT PÚBLICO
//
// Tiene que serlo: el navegador postea sin sesión (y con la Reporting API,
// sin cookies). Está fuera del matcher del middleware. De ahí las tres
// defensas:
//   - se lee el cuerpo con un tope de tamaño;
//   - no se refleja NADA de lo recibido en la respuesta;
//   - se contesta siempre 204, así no hay diferencia observable entre un
//     reporte aceptado y uno descartado.

import { NextResponse } from "next/server";

import { formatearViolacion, normalizarReportes } from "@/lib/csp-reportes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope del cuerpo. Un reporte real son unos cientos de bytes. */
const MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  // Siempre 204, pase lo que pase: el navegador no tiene nada que hacer con
  // la respuesta, y un endpoint público no debería contar nada de sí mismo.
  const sinContenido = new NextResponse(null, { status: 204 });

  const largo = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(largo) && largo > MAX_BYTES) {
    console.warn(`[csp] reporte descartado por tamaño (${largo} bytes)`);
    return sinContenido;
  }

  let crudo: string;
  try {
    crudo = await request.text();
  } catch {
    return sinContenido;
  }

  // Segunda guarda: content-length puede faltar o mentir.
  if (crudo.length > MAX_BYTES) {
    console.warn(`[csp] reporte descartado por tamaño (${crudo.length} bytes)`);
    return sinContenido;
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return sinContenido;
  }

  for (const violacion of normalizarReportes(cuerpo)) {
    console.warn(formatearViolacion(violacion));
  }

  return sinContenido;
}
