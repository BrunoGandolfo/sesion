// El proxy (convención de Next 16; reemplaza a src/middleware.ts). Hace
// exactamente dos cosas, y nada más:
//
//   1. Redirección OPTIMISTA: sin cookie de sesión y ruta no pública →
//      /login; con cookie y /login → /. No valida la cookie ni toca la
//      base: eso lo hace getSessionActor() en cada ruta y en el layout del
//      dashboard, con una consulta indexada. La doc de Next lo dice
//      textual: el proxy es para "optimistic checks", no para gestionar la
//      sesión. Además rechaza con 403 un POST/PATCH/DELETE que no venga del
//      propio sitio (segunda capa contra CSRF, además de SameSite=Lax).
//   2. La Content-Security-Policy con nonce por request (src/lib/csp.ts).
//
// Importa SOLO @/lib/csp y @/lib/sesion-cookie. Es la regla 9 de AGENTS.md y
// la fija src/lib/__tests__/proxy-liviano.test.ts: el proxy no conoce la
// base, la autenticación ni ningún módulo pesado. Un proxy que consulta la
// base es una consulta por request para todos los estáticos y prefetches, y
// un proxy que no puede caer sin tirar la app entera.

import { NextResponse, type NextRequest } from "next/server";

import { cabeceraReportingEndpoints, construirCsp, generarNonce } from "@/lib/csp";
import {
  esOrigenPropio,
  esRutaPublica,
  nombreCookie,
} from "@/lib/sesion-cookie";

/** Con este parámetro /login no redirige a / aunque haya cookie: el layout
 *  del dashboard manda acá cuando la cookie no resuelve a una sesión viva,
 *  y la pantalla de entrada la borra. Sin esto habría un bucle. */
export const PARAM_SESION_VENCIDA = "sesion";

/**
 * Deja la respuesta con la política en modo reporte y con el endpoint al que
 * mandar los reportes. Report-Only en la RESPUESTA y política enforzada en
 * el PEDIDO no es una contradicción: la del pedido no sale al navegador,
 * sólo la lee Next para saber qué nonce ponerle a sus scripts.
 */
function conReporteCsp(respuesta: NextResponse, politica: string, origen: string): NextResponse {
  respuesta.headers.set("Content-Security-Policy-Report-Only", politica);
  respuesta.headers.set("Reporting-Endpoints", cabeceraReportingEndpoints(origen));
  return respuesta;
}

export function proxy(request: NextRequest) {
  const { nextUrl } = request;
  const host = request.headers.get("host") ?? nextUrl.host;
  const origen = `${nextUrl.protocol}//${host}`;

  const nonce = generarNonce();
  const politica = construirCsp(nonce, {
    desarrollo: process.env.NODE_ENV !== "production",
  });

  if (!esOrigenPropio(request.method, request.headers, host)) {
    return conReporteCsp(
      NextResponse.json({ error: "Origen no permitido" }, { status: 403 }),
      politica,
      origen,
    );
  }

  const hayCookie = request.cookies.has(nombreCookie());
  const esLogin = nextUrl.pathname === "/login";

  if (!hayCookie && !esRutaPublica(nextUrl.pathname)) {
    return conReporteCsp(NextResponse.redirect(new URL("/login", origen)), politica, origen);
  }

  if (hayCookie && esLogin && !nextUrl.searchParams.has(PARAM_SESION_VENCIDA)) {
    return conReporteCsp(NextResponse.redirect(new URL("/", origen)), politica, origen);
  }

  // El nonce viaja al renderizador por las cabeceras del PEDIDO.
  const cabecerasPedido = new Headers(request.headers);
  cabecerasPedido.set("x-nonce", nonce);
  cabecerasPedido.set("Content-Security-Policy", politica);

  return conReporteCsp(
    NextResponse.next({ request: { headers: cabecerasPedido } }),
    politica,
    origen,
  );
}

export const config = {
  matcher: [
    // Fuera del proxy: estáticos; rutas públicas de máquina a máquina o de
    // webhooks, que se autentican por Bearer o por firma en la propia ruta
    // (contrato con las áreas 2, 4 y 5):
    //   api/cron/**                       CRON_SECRET
    //   api/health, api/estado-worker     monitores externos, sin sesión
    //   api/csp-report                    lo postea el navegador sin sesión
    //   api/sesion-clinica/pendientes y [id]/{lease,asr,resultado,transcripcion}
    //                                     worker (PROCESSING_SECRET / ticket)
    //   api/trabajos/**                   worker
    //   api/pacientes/[id]/hilo           GET ?format=llm del worker (la ruta
    //                                     decide entre ticket y sesión)
    //   api/sms/**                        webhooks firmados de Twilio
    //   api/seed                          SEED_SECRET (solo desarrollo)
    "/((?!_next/static|_next/image|static|favicon.ico|icon/|apple-icon|manifest.webmanifest|api/seed|api/cron|api/health|api/estado-worker|api/csp-report|api/sesion-clinica/pendientes|api/sesion-clinica/[^/]+/(?:lease|asr|resultado|transcripcion)|api/trabajos|api/pacientes/[^/]+/hilo|api/sms|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
