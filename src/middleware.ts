import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  cabeceraReportingEndpoints,
  construirCsp,
  generarNonce,
} from "@/lib/csp";

// ────────────────────────────────────────────────────────────────────────────
// Además de la sesión, el middleware pone la Content-Security-Policy.
//
// Tiene que ser acá y no en next.config.ts porque la política lleva un NONCE
// por request, y next.config sólo puede emitir cabeceras estáticas. Todo el
// razonamiento (por qué un nonce, por qué strict-dynamic, por qué style-src
// sigue con unsafe-inline) está en src/lib/csp.ts.
//
// Report-Only: nada se bloquea todavía. El navegador recibe
// `Content-Security-Policy-Report-Only` y postea las violaciones a
// /api/csp-report. El plan para pasar a enforce está en AGENTS.md.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deja la respuesta con la política en modo reporte y con el endpoint al que
 * mandar los reportes.
 *
 * Report-Only en la RESPUESTA y política enforzada en el PEDIDO no es una
 * contradicción: la del pedido no sale al navegador, sólo la lee Next para
 * saber qué nonce ponerle a sus scripts.
 */
function conReporteCsp(
  respuesta: NextResponse,
  politica: string,
  origen: string,
): NextResponse {
  respuesta.headers.set("Content-Security-Policy-Report-Only", politica);
  respuesta.headers.set(
    "Reporting-Endpoints",
    cabeceraReportingEndpoints(origen),
  );
  return respuesta;
}

export default auth((request) => {
  const isLoggedIn = Boolean(request.auth);
  const { nextUrl } = request;
  const isLoginRoute = nextUrl.pathname === "/login";
  const origin = `${nextUrl.protocol}//${
    request.headers.get("host") ?? nextUrl.host
  }`;

  const nonce = generarNonce();
  const politica = construirCsp(nonce, {
    desarrollo: process.env.NODE_ENV !== "production",
  });

  if (!isLoggedIn && !isLoginRoute) {
    const loginUrl = new URL("/login", origin);
    return conReporteCsp(NextResponse.redirect(loginUrl), politica, origin);
  }

  if (isLoggedIn && isLoginRoute) {
    return conReporteCsp(
      NextResponse.redirect(new URL("/", origin)),
      politica,
      origin,
    );
  }

  // El nonce viaja al renderizador por las cabeceras del PEDIDO. `x-nonce`
  // queda disponible por si alguna página necesita nonciar un script propio
  // (hoy ninguna lo hace); `Content-Security-Policy` es la que Next lee para
  // ponerle el nonce a los suyos.
  const cabecerasPedido = new Headers(request.headers);
  cabecerasPedido.set("x-nonce", nonce);
  cabecerasPedido.set("Content-Security-Policy", politica);

  return conReporteCsp(
    NextResponse.next({ request: { headers: cabecerasPedido } }),
    politica,
    origin,
  );
});

export const config = {
  matcher: [
    // Cron endpoints se autentican por CRON_SECRET header, no por sesión.
    // /api/health es público para servicios de monitoreo (UptimeRobot, etc.).
    // /api/csp-report lo postea el navegador para avisar de una violación de
    // la CSP: no lleva sesión, y redirigirlo a /login perdería el reporte.
    // /api/sesion-clinica/{callback,pendientes,aprobadas-sin-contexto} son
    // machine-to-machine (worker Python / La Escondida), se autentican por
    // PROCESSING_SECRET header (Bearer) en la propia ruta.
    // /api/pacientes/{id}/contexto-clinico (GET) acepta Bearer PROCESSING_SECRET
    // para que el worker arme el prompt del LLM; la propia ruta decide entre
    // auth M2M y session.
    "/((?!_next/static|_next/image|static|favicon.ico|api/auth|api/seed|api/cron|api/health|api/csp-report|api/sesion-clinica/callback|api/sesion-clinica/pendientes|api/sesion-clinica/aprobadas-sin-contexto|api/pacientes/[^/]+/contexto-clinico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
