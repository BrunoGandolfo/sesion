// Init de Sentry en el navegador. Convención de Next.js 16 (Turbopack): vive
// en la raíz como `instrumentation-client.ts`.
//
// Política de datos: la MISMA lista de permitidos que el servidor
// (src/lib/telemetria-saneo.ts). Sin Session Replay, sin PII por defecto;
// de un fetch solo método, ruta sin query y status.
import * as Sentry from "@sentry/nextjs";

import { sanearBreadcrumb, sanearEvento } from "./src/lib/telemetria-saneo";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
