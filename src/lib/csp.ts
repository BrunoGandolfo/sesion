// Content-Security-Policy con nonce por request.
//
// POR QUÉ UN NONCE Y NO LA LISTA DE ANTES
//
// La CSP que había (en next.config.ts) declaraba `script-src 'self'
// 'unsafe-inline'`, y ese `'unsafe-inline'` la volvía decorativa: es
// exactamente el permiso que necesita un XSS para ejecutarse. Estaba puesto
// porque Next inyecta scripts inline (hidratación, payload de RSC) y sin
// nonces no había forma de permitirlos sin permitirlos todos.
//
// El nonce resuelve eso: se genera uno distinto por request, va en la
// política y va en los `<script>` que Next emite. Un script inyectado por un
// atacante no puede adivinarlo, así que no corre. Los de la app sí.
//
// CÓMO LLEGA EL NONCE A LOS SCRIPTS DE NEXT
//
// El middleware lo pone en las CABECERAS DEL PEDIDO (no en las de la
// respuesta: esas van al navegador, aquéllas son el canal interno hacia el
// renderizador). Next lee `Content-Security-Policy` del pedido, le saca el
// `'nonce-…'` y se lo pone a sus propios scripts.
//
// Eso permite algo que acá importa: el pedido lleva la política ENFORZADA
// (para que Next haga su parte) y la respuesta lleva sólo
// `Content-Security-Policy-Report-Only` (para que el navegador no bloquee
// nada todavía). El navegador nunca ve la versión enforzada.
//
// AGENTS.md tiene el plan para pasar a enforce y qué mirar antes.
//
// Sin `node:*`: esto lo importa el middleware, que corre en el runtime edge
// (regla 9 de AGENTS.md). El nonce sale de Web Crypto.

/** Dónde se reciben las violaciones. Pública: el navegador la postea sin
 *  sesión, así que está fuera del matcher del middleware. */
export const RUTA_REPORTE_CSP = "/api/csp-report";

/** Nombre del endpoint para la Reporting API (cabecera Reporting-Endpoints). */
export const NOMBRE_ENDPOINT_REPORTE = "csp-endpoint";

/**
 * 16 bytes = 128 bits de aleatoriedad. La recomendación del W3C es "al menos
 * 128 bits", y de todas formas el nonce vive lo que vive el request.
 */
const NONCE_BYTES = 16;

/** Un nonce nuevo, en base64. Web Crypto, no `node:crypto`. */
export function generarNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  let binario = "";
  for (const byte of bytes) {
    binario += String.fromCharCode(byte);
  }
  return btoa(binario);
}

/** Destinos externos a los que el navegador puede hablar. Hoy sólo Sentry. */
const CONNECT_EXTERNOS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
];

export interface OpcionesCsp {
  /** En desarrollo Next usa eval para React Refresh. Ver abajo. */
  desarrollo?: boolean;
}

/**
 * La política, con el nonce ya adentro.
 *
 * Decisiones que conviene tener escritas:
 *
 * - `script-src` NO lleva `'unsafe-inline'`. Ése es el punto entero del
 *   cambio. Lleva `'strict-dynamic'`, que hace que un script con nonce pueda
 *   cargar a los suyos (Next carga sus chunks así) y que, en los navegadores
 *   que lo entienden, `'self'` y cualquier lista de hosts se IGNOREN. Es
 *   deliberadamente estricto: en modo report-only, lo que queremos es que
 *   nos avise de todo lo que no tiene nonce, no que lo tape.
 *
 * - `style-src` SÍ conserva `'unsafe-inline'`, y va a costar sacarlo:
 *   Tailwind v4 y framer-motion escriben estilos en el atributo `style` de
 *   los elementos, y los nonces no cubren atributos (sólo elementos
 *   `<style>`). Es una pelea aparte y posterior.
 *
 * - `'unsafe-eval'` sólo en desarrollo: React Refresh lo necesita. En
 *   producción no está, y si algún día aparece un reporte pidiéndolo hay que
 *   ir a ver qué lo pide, no agregarlo.
 *
 * - `frame-ancestors 'none'` está igual acá que en la CSP enforzada de
 *   next.config.ts. Duplicado a propósito: una política report-only NO
 *   impide el embebido, así que la de verdad tiene que seguir existiendo
 *   aparte; y tenerla acá también hace que, el día que esta pase a enforce,
 *   no haya que acordarse de agregarla.
 */
export function construirCsp(
  nonce: string,
  { desarrollo = false }: OpcionesCsp = {},
): string {
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(desarrollo ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_EXTERNOS.join(" ")}`,
    // MediaRecorder y la reproducción local trabajan con blobs.
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    // report-uri está deprecado pero es lo que hoy entienden todos los
    // navegadores; report-to es el sucesor y lo entiende Chromium. Van los
    // dos: durante la etapa de report-only lo que importa es no perder
    // reportes.
    `report-uri ${RUTA_REPORTE_CSP}`,
    `report-to ${NOMBRE_ENDPOINT_REPORTE}`,
  ].join("; ");
}

/**
 * Valor de la cabecera `Reporting-Endpoints`, que es la que le da sentido a
 * `report-to`. Necesita URL absoluta, de ahí el origen.
 */
export function cabeceraReportingEndpoints(origen: string): string {
  return `${NOMBRE_ENDPOINT_REPORTE}="${origen}${RUTA_REPORTE_CSP}"`;
}
