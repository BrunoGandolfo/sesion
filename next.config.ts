import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ────────────────────────────────────────────────────────────────────────────
// Headers de seguridad.
//
// - HSTS: 2 años, con subdominios. Sin `preload` a propósito: entrar a la
//   lista de precarga es irreversible en la práctica y no hace falta para una
//   app con una sola usuaria.
// - frame-ancestors 'none' va en una CSP ENFORZADA mínima (una CSP
//   report-only no bloquea el embedding). X-Frame-Options queda como
//   fallback para navegadores viejos.
// - La CSP completa va en Content-Security-Policy-Report-Only: no bloquea
//   nada, solo loguea violaciones en la consola del navegador. Cuando se
//   verifique que no hay violaciones en uso real, se promueve a
//   Content-Security-Policy (y se puede fusionar con la de frame-ancestors).
// - Permissions-Policy: el micrófono es la única capacidad que la app usa
//   (grabación de sesiones); se restringe al mismo origen.
// ────────────────────────────────────────────────────────────────────────────

const cspReportOnly = [
  "default-src 'self'",
  // Next.js inyecta scripts inline (hidratación, RSC payload). Sin nonces
  // vía middleware no se puede evitar 'unsafe-inline' acá.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind 4 y framer-motion escriben estilos inline.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Sentry (ingest) es el único destino externo desde el navegador.
  "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  // MediaRecorder / reproducción local trabajan con blobs.
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  {
    key: "Permissions-Policy",
    value:
      "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "sesion",
  project: "sesion-app",
  silent: true, // no loguear durante build
  sourcemaps: {
    disable: true, // no subir sourcemaps por ahora
  },
});
