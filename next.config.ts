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
// - Permissions-Policy: el micrófono es la única capacidad que la app usa
//   (grabación de sesiones); se restringe al mismo origen.
//
// LA CSP COMPLETA YA NO ESTÁ ACÁ
//
// Estaba, con `script-src 'self' 'unsafe-inline'`, y ese 'unsafe-inline' la
// volvía decorativa: es exactamente el permiso que necesita un XSS. Estaba
// puesto porque Next inyecta scripts inline y sin nonces no había forma de
// permitir los suyos sin permitirlos todos.
//
// Ahora la política lleva un nonce por request, y un nonce por request no
// puede salir de una cabecera estática: se emite desde src/middleware.ts,
// con la política en src/lib/csp.ts. Sigue siendo Report-Only.
//
// Consecuencia a tener presente: las rutas que el matcher del middleware
// excluye (estáticos, /api/auth, los endpoints del cron y los M2M) ya no
// llevan CSP. Ninguna devuelve HTML, así que no hay nada que una CSP pueda
// proteger ahí; los headers de esta lista sí las siguen cubriendo.
// ────────────────────────────────────────────────────────────────────────────

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Enforzada y mínima: una CSP report-only NO impide el embebido, así que
  // esta tiene que existir aparte de la del middleware.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
  // El asistente de ayuda lee docs/ayuda/*.md del disco en tiempo de
  // ejecución (src/lib/ayuda-corpus.ts): el corpus entero va al system
  // prompt, sin base vectorial.
  //
  // Next arma el bundle de cada función siguiendo los IMPORTS, y una lectura
  // con readFileSync no es un import: sin esta línea los documentos no viajan
  // y /api/ayuda contesta ERROR_CORPUS_AUSENTE en Vercel. En local no se nota
  // —ahí el archivo está donde siempre—, así que el agujero solo aparece
  // deployado. La clave es la ruta de la ruta; el valor, relativo a la raíz.
  outputFileTracingIncludes: {
    "/api/ayuda": ["./docs/ayuda/**"],
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
