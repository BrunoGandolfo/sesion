// Instrumentation hook de Next.js 16. Reemplaza al deprecado
// sentry.server.config.ts: Sentry.init debe correr dentro de register()
// para inicializarse en el server y en el edge runtime.
import * as Sentry from "@sentry/nextjs";

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
    });
  }
}

// Reporta errores capturados por Next desde Server Components,
// route handlers y server actions al hook onRequestError.
export const onRequestError = Sentry.captureRequestError;
