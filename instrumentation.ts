// Instrumentation hook de Next.js 16. Reemplaza al deprecado
// sentry.server.config.ts: Sentry.init debe correr dentro de register()
// para inicializarse en el server y en el edge runtime.
//
// Política de datos: esta app maneja datos clínicos. Del lado server los
// errores más probables son de Prisma o de validación, y sus mensajes pueden
// arrastrar valores de columnas o fragmentos del body. `beforeSend` borra el
// body y las cookies del request, limpia y trunca los mensajes de excepción,
// y `beforeBreadcrumb` descarta los breadcrumbs de consola.
import * as Sentry from "@sentry/nextjs";

const MAX_MENSAJE = 200;

const PATRONES_SENSIBLES: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\+\d{7,15}/g, "[tel]"],
  [/[A-Za-z0-9+/]{32,}={0,2}/g, "[base64]"],
];

function limpiarTexto(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  let out = valor;
  for (const [re, reemplazo] of PATRONES_SENSIBLES) {
    out = out.replace(re, reemplazo);
  }
  if (out.length > MAX_MENSAJE) {
    out = `${out.slice(0, MAX_MENSAJE)}… [truncado ${out.length - MAX_MENSAJE} chars]`;
  }
  return out;
}

function limpiarEvento(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
  }
  if (event.message) {
    event.message = limpiarTexto(event.message);
  }
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = limpiarTexto(ex.value);
    }
  }
  delete event.extra;
  delete event.user;
  return event;
}

export async function register() {
  if (!process.env.SENTRY_DSN) return;

  // Mismo init para Node.js (RSC, route handlers, server actions)
  // y edge (middleware). @sentry/nextjs resuelve el SDK correcto.
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
      sendDefaultPii: false,
      beforeSend(event) {
        return limpiarEvento(event);
      },
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === "console") return null;
        if (breadcrumb.message) {
          breadcrumb.message = limpiarTexto(breadcrumb.message);
        }
        return breadcrumb;
      },
    });
  }
}

// Reporta errores capturados por Next desde Server Components,
// route handlers y server actions al hook onRequestError.
export const onRequestError = Sentry.captureRequestError;
