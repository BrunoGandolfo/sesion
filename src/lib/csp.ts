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
// LAS PÁGINAS TIENEN QUE SER DINÁMICAS
//
// Corolario de lo anterior: una página prerenderizada en el build no tiene
// request, así que Next no le puede poner el nonce a sus scripts. Queda
// emitiendo violaciones de script-src en cada carga, y el día que la
// política se enforce esa página no hidrata. Por eso (dashboard)/layout.tsx
// y (auth)/layout.tsx declaran `dynamic = "force-dynamic"`: hoy cubren toda
// la app. Una página nueva fuera de esos dos grupos tiene que declararlo
// también.
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

// ────────────────────────────────────────────────────────────────────────────
// Destinos externos
//
// Todo host externo al que el NAVEGADOR habla, uno solo y con nombre. Si un
// host no está acá, la política lo bloquea el día del enforce; y si está acá
// sin que nadie sepa por qué, la política es más ancha de lo que debería.
// src/lib/__tests__/csp-destinos.test.ts recorre src/** y falla ante un host
// nuevo que no esté declarado en ningún lado.
//
// R2: el navegador hace PUT del audio cifrado DIRECTO al bucket (la URL la
// firma /api/sesion-clinica/[id]/upload-url). Va como host EXACTO, de la
// variable R2_PUBLIC_HOST. OJO con la forma: el SDK de S3 firma en estilo
// "virtual-hosted", así que la URL prefirmada tiene el BUCKET como primer
// subdominio y el origen es
//   https://<bucket>.<accountId>.r2.cloudflarestorage.com
// (verificado generando una URL con src/lib/r2.ts; csp-destinos.test.ts lo
// vuelve a verificar en cada corrida). Una fuente exacta de CSP no cubre
// subdominios: con el host de la cuenta a secas, la subida sigue afuera.
//   - explícito y no derivado de R2_ACCOUNT_ID, porque el middleware corre en
//     edge y no tiene por qué saber cómo Cloudflare arma sus nombres;
//   - exacto y no `https://*.r2.cloudflarestorage.com`, porque un comodín
//     abre la política a cualquier cuenta de R2 del mundo, y "igual la URL la
//     firma nuestro servidor" es cierto sólo mientras no haya un XSS, que es
//     exactamente el escenario contra el que existe la CSP;
//   - el id de cuenta viaja igual en cada URL prefirmada, así que no es un
//     secreto.
// Cuando esta política se escribió (septiembre de 2026) R2 NO estaba, y
// enforzar habría roto la subida de toda grabación. Ver AGENTS.md.
// ────────────────────────────────────────────────────────────────────────────

export interface DestinosExternos {
  sentry: readonly string[];
  /** Vacío si R2_PUBLIC_HOST falta o no es un host exacto. */
  r2: readonly string[];
}

const SENTRY = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
] as const;

/** Sufijo que todo endpoint S3 de R2 tiene (src/lib/r2.ts arma el de la
 *  cuenta; el SDK le antepone el bucket al firmar). */
export const SUFIJO_HOST_R2 = ".r2.cloudflarestorage.com";

/**
 * `https://<host>` exacto, o null si el valor no sirve: sin esquema, con
 * comodín, con ruta o puerto, o con un host que no es de R2. Pura.
 */
export function validarHostR2(valor: string | undefined): string | null {
  const limpio = valor?.trim();
  if (!limpio) return null;
  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search || url.hash || url.port) return null;
  if (url.hostname.includes("*")) return null;
  if (!url.hostname.endsWith(SUFIJO_HOST_R2)) return null;
  if (url.hostname === SUFIJO_HOST_R2.slice(1)) return null;
  return `https://${url.hostname}`;
}

/** Los destinos a partir del ambiente. Pura: recibe el env. */
export function construirDestinos(
  env: Record<string, string | undefined> = process.env,
): DestinosExternos {
  const r2 = validarHostR2(env.R2_PUBLIC_HOST);
  return { sentry: SENTRY, r2: r2 ? [r2] : [] };
}

/** Todos los hosts, planos, en el orden en que van a connect-src. */
export function hostsExternos(destinos: DestinosExternos): string[] {
  return [...destinos.sentry, ...destinos.r2];
}

/**
 * Los destinos de este despliegue. Si R2_PUBLIC_HOST falta, R2 queda AFUERA
 * de la política: en report-only eso sólo genera reportes de connect-src; en
 * enforce rompería la subida. Por eso la variable es obligatoria en
 * producción (src/lib/env-operacion.ts) y /api/health contesta 503 sin ella.
 */
export const DESTINOS_EXTERNOS: DestinosExternos = construirDestinos();

export interface OpcionesCsp {
  /** En desarrollo Next usa eval para React Refresh. Ver abajo. */
  desarrollo?: boolean;
  /** Para tests: los destinos en vez de los del ambiente. */
  destinos?: DestinosExternos;
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
  { desarrollo = false, destinos = DESTINOS_EXTERNOS }: OpcionesCsp = {},
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
    `connect-src 'self' ${hostsExternos(destinos).join(" ")}`,
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
