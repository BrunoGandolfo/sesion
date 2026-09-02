// Init de Sentry en el cliente. Convención de Next.js 16 (Turbopack):
// debe vivir en la raíz como `instrumentation-client.ts`. El antiguo
// `sentry.client.config.ts` es ignorado por Turbopack en producción.
//
// Política de datos: esta app maneja datos clínicos. Sentry recibe SOLO el
// tipo de error y el stack. No se activa Session Replay (no se agrega
// `replayIntegration`), no se envía PII por defecto, y `beforeSend` /
// `beforeBreadcrumb` limpian cualquier cuerpo de request, cookie, mensaje
// largo o breadcrumb de consola antes de salir del navegador.
import * as Sentry from "@sentry/nextjs";

// Longitud máxima de un mensaje de excepción. Los mensajes propios de la app
// son cortos ("No pudimos guardar la nota…"); un mensaje largo suele ser un
// error de red o de parseo que arrastra contenido.
const MAX_MENSAJE = 200;

// Patrones que nunca deben viajar: emails, teléfonos E.164 y blobs base64
// largos (claves, IVs, audio, firmas).
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
  // `extra` y `contexts` pueden contener objetos arbitrarios pasados por
  // captureException; no hay un uso así hoy, pero se vacían por si aparece.
  delete event.extra;
  delete event.user;
  return event;
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1, // 10% de traces en producción
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    beforeSend(event) {
      return limpiarEvento(event);
    },
    beforeBreadcrumb(breadcrumb) {
      // Los breadcrumbs de consola pueden llevar objetos con datos clínicos
      // (console.error(error) en los handlers). Se descartan enteros.
      if (breadcrumb.category === "console") return null;
      // Para fetch/xhr se conservan método, URL y status; nunca el body.
      if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
        if (breadcrumb.data) {
          delete breadcrumb.data.body;
          delete breadcrumb.data.request_body_size;
          delete breadcrumb.data.response_body_size;
        }
        return breadcrumb;
      }
      if (breadcrumb.message) {
        breadcrumb.message = limpiarTexto(breadcrumb.message);
      }
      return breadcrumb;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
