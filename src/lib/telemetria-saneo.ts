// Qué puede salir hacia Sentry. Una sola política para el servidor
// (instrumentation.ts) y el navegador (instrumentation-client.ts), por LISTA
// DE PERMITIDOS: del evento se conserva únicamente lo que está acá; todo lo
// demás se descarta. Antes había dos copias de una lista de prohibidos
// (borrar body, cookies, authorization…), y una lista de prohibidos falla
// hacia afuera: lo que nadie previó, viaja.
//
// Esta app maneja datos clínicos. A Sentry le alcanza con el TIPO de error,
// el stack y dónde pasó. Nunca una URL con query (un token de recuperación
// viaja en la query de /restablecer), nunca un body, una cookie, un header
// de autorización ni un breadcrumb de consola.
//
// Módulo puro: sin Node, sin Sentry. Solo transforma objetos.

export const MAX_MENSAJE = 200;

const PATRONES_SENSIBLES: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\+\d{7,15}/g, "[tel]"],
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, "[token]"],
];

/** Sin emails, teléfonos ni tokens/blobs largos, y acotado. */
export function limpiarTexto(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  let out = valor;
  for (const [re, reemplazo] of PATRONES_SENSIBLES) out = out.replace(re, reemplazo);
  if (out.length > MAX_MENSAJE) {
    out = `${out.slice(0, MAX_MENSAJE)}… [truncado ${out.length - MAX_MENSAJE} chars]`;
  }
  return out;
}

/** Solo origen y ruta. Sin query, sin fragmento, sin userinfo. */
export function urlSinQuery(valor: unknown): string | undefined {
  if (typeof valor !== "string" || valor === "") return undefined;
  try {
    const u = new URL(valor, "http://relativa.invalid");
    const esRelativa = u.origin === "http://relativa.invalid";
    return `${esRelativa ? "" : u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/** Tags que se conservan (las pone la app o el SDK; nada de usuario). */
const TAGS_PERMITIDOS = new Set(["runtime", "transaction", "url", "http.method", "handled", "mechanism"]);

type Objeto = Record<string, unknown>;

function esObjeto(v: unknown): v is Objeto {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface ExcepcionSaneada {
  type?: string;
  value?: string;
  stacktrace?: unknown;
  mechanism?: unknown;
}

function sanearExcepcion(ex: unknown): ExcepcionSaneada | null {
  if (!esObjeto(ex)) return null;
  const out: ExcepcionSaneada = {};
  if (typeof ex.type === "string") out.type = ex.type.slice(0, 100);
  if (typeof ex.value === "string") out.value = limpiarTexto(ex.value);
  // El stack son rutas de archivos y funciones: sin datos.
  if (ex.stacktrace !== undefined) out.stacktrace = ex.stacktrace;
  if (ex.mechanism !== undefined) out.mechanism = ex.mechanism;
  return out;
}

/**
 * El evento que puede salir. Se construye desde cero con lo permitido:
 * identidad del evento, tipo y stack de la excepción, mensaje limpio, nivel,
 * ambiente, release, método y ruta del request (sin query), tags de la lista
 * y los contextos técnicos (runtime, os, browser, device, app). NUNCA: body,
 * cookies, headers, user, extra, contexts arbitrarios, query.
 */
export function sanearEvento<E extends object>(evento: E): E {
  const event = evento as unknown as Objeto;
  const out: Objeto = {};
  for (const clave of ["event_id", "timestamp", "platform", "level", "environment", "release", "dist", "sdk", "type", "fingerprint", "logger", "transaction"] as const) {
    if (event[clave] !== undefined) out[clave] = event[clave];
  }
  if (typeof out.transaction === "string") out.transaction = urlSinQuery(out.transaction) ?? out.transaction;
  if (event.message !== undefined) out.message = limpiarTexto(event.message);

  if (esObjeto(event.exception) && Array.isArray(event.exception.values)) {
    out.exception = { values: event.exception.values.map(sanearExcepcion).filter((e) => e !== null) };
  }

  if (esObjeto(event.request)) {
    const request: Objeto = {};
    if (typeof event.request.method === "string") request.method = event.request.method;
    const url = urlSinQuery(event.request.url);
    if (url) request.url = url;
    out.request = request;
  }

  if (esObjeto(event.tags)) {
    const tags: Objeto = {};
    for (const [k, v] of Object.entries(event.tags)) {
      if (TAGS_PERMITIDOS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        tags[k] = typeof v === "string" ? (k === "url" ? urlSinQuery(v) : limpiarTexto(v)) : v;
      }
    }
    out.tags = tags;
  }

  if (esObjeto(event.contexts)) {
    const contexts: Objeto = {};
    for (const k of ["runtime", "os", "browser", "device", "app", "trace"]) {
      if (event.contexts[k] !== undefined) contexts[k] = event.contexts[k];
    }
    out.contexts = contexts;
  }

  return out as unknown as E;
}

/**
 * Breadcrumbs: consola afuera entera (arrastra objetos con datos clínicos);
 * fetch/xhr solo método, ruta sin query y status; navegación solo rutas sin
 * query; el resto, categoría, nivel y mensaje limpio.
 */
export function sanearBreadcrumb<B extends object>(crumb: B): B | null {
  const breadcrumb = crumb as unknown as Objeto;
  const categoria = typeof breadcrumb.category === "string" ? breadcrumb.category : "";
  if (categoria === "console") return null;

  const out: Objeto = {};
  for (const clave of ["timestamp", "category", "level", "type"] as const) {
    if (breadcrumb[clave] !== undefined) out[clave] = breadcrumb[clave];
  }
  const data = esObjeto(breadcrumb.data) ? breadcrumb.data : {};

  if (categoria === "fetch" || categoria === "xhr") {
    const d: Objeto = {};
    if (typeof data.method === "string") d.method = data.method;
    const url = urlSinQuery(data.url);
    if (url) d.url = url;
    if (typeof data.status_code === "number") d.status_code = data.status_code;
    out.data = d;
    return out as unknown as B;
  }

  if (categoria === "navigation") {
    const d: Objeto = {};
    const from = urlSinQuery(data.from);
    const to = urlSinQuery(data.to);
    if (from) d.from = from;
    if (to) d.to = to;
    out.data = d;
    return out as unknown as B;
  }

  if (breadcrumb.message !== undefined) out.message = limpiarTexto(breadcrumb.message);
  return out as unknown as B;
}
