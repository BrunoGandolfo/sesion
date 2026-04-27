// Init de Sentry en el cliente. Detectado automáticamente por @sentry/nextjs
// y inyectado en el bundle del browser.
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1, // 10% de traces en producción
    replaysSessionSampleRate: 0, // no grabar sesiones
    replaysOnErrorSampleRate: 0.5, // grabar 50% de sesiones con error
    environment: process.env.NODE_ENV,
  });
}
