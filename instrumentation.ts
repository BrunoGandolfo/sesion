// Instrumentation hook de Next.js 16: Sentry.init corre dentro de register()
// para inicializarse en el servidor.
//
// Política de datos: esta app maneja datos clínicos. Lo que sale hacia
// Sentry lo decide UNA lista de permitidos compartida con el navegador
// (src/lib/telemetria-saneo.ts): tipo y stack del error, mensaje limpio,
// método y ruta del request sin query. Nunca body, cookies, headers,
// usuario, extra ni breadcrumbs de consola.
import * as Sentry from "@sentry/nextjs";

import { sanearBreadcrumb, sanearEvento } from "./src/lib/telemetria-saneo";

export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
      sendDefaultPii: false,
      beforeSend(event) {
        return sanearEvento(event);
      },
      beforeBreadcrumb(breadcrumb) {
        return sanearBreadcrumb(breadcrumb);
      },
    });
  }
}

// Reporta errores capturados por Next desde Server Components,
// route handlers y server actions al hook onRequestError.
export const onRequestError = Sentry.captureRequestError;
