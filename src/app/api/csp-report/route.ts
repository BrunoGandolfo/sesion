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
//   - se lee el cuerpo de a pedazos, con el tope puesto antes de tenerlo
//     entero en memoria;
//   - no se refleja NADA de lo recibido en la respuesta;
//   - se contesta siempre 204, así no hay diferencia observable entre un
//     reporte aceptado y uno descartado.

import { NextResponse } from "next/server";

import {
  formatearViolacion,
  leerCuerpoConTope,
  MAX_BYTES,
  normalizarReportes,
} from "@/lib/csp-reportes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Siempre 204, pase lo que pase: el navegador no tiene nada que hacer con
  // la respuesta, y un endpoint público no debería contar nada de sí mismo.
  const sinContenido = new NextResponse(null, { status: 204 });

  // Atajo barato cuando el que postea dice la verdad: ni se abre el stream.
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(largo) && largo > MAX_BYTES) {
    console.warn(`[csp] reporte descartado por tamaño (${largo} bytes)`);
    return sinContenido;
  }

  // Y la guarda de verdad, para cuando falta o miente: el tope se aplica
  // MIENTRAS se lee, no después. Ver leerCuerpoConTope.
  const crudo = await leerCuerpoConTope(request, MAX_BYTES);
  if (crudo === null) {
    console.warn(
      `[csp] reporte descartado por tamaño (más de ${MAX_BYTES} bytes)`,
    );
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
