// La regla del service worker (src/app/sw.ts), sin nada de Serwist, para
// que un test la pueda leer y comprobar.
//
// QUÉ GUARDA EL SERVICE WORKER EN EL TELÉFONO
//
//   - Los archivos estáticos de la app (`/_next/static/**`: JS, CSS,
//     fuentes, íconos). Llevan un hash en el nombre y no tienen datos de
//     nadie.
//   - La pantalla `/sin-conexion` (src/app/sin-conexion), que no trae datos:
//     lee del teléfono la agenda local (src/lib/agenda-local.ts).
//
// Y NADA MÁS. NUNCA se guarda `/api/**` ni el HTML de ninguna otra ruta: ni
// notas, ni transcripciones, ni fichas. Las navegaciones van SIEMPRE a la red
// y no se copian; si la red falla, se muestra `/sin-conexion`. Todo lo demás
// (las llamadas a la API, el RSC de Next, la subida a R2) el service worker
// ni lo toca: no hay ruta que lo atienda, así que va directo a la red como
// si el service worker no existiera.
//
// src/lib/__tests__/sw-politica.test.ts lo verifica contra el service worker
// de verdad (src/app/sw.ts) con Serwist reemplazado por un doble.

/** Dónde se sirve el service worker (src/app/serwist/[path]/route.ts). */
export const URL_SW = "/serwist/sw.js";

/** La pantalla que se muestra cuando una navegación no llega a la red. */
export const RUTA_SIN_CONEXION = "/sin-conexion";

/** Prefijo de los estáticos de Next: nombres con hash, sin datos. */
const PREFIJO_ESTATICOS = "/_next/static/";

/**
 * Lo que el build precarga: los estáticos de `.next/static` (Serwist los
 * publica como `/_next/static/...`). Fuentes incluidas, que el patrón por
 * defecto de Serwist deja afuera.
 */
export const PATRONES_PRECARGA = [".next/static/**/*.{js,css,woff2,ico,png,svg,webp}"];

/**
 * Las actualizaciones: el service worker nuevo se activa apenas se instala
 * (skipWaiting) y toma las pestañas abiertas (clientsClaim). Así una versión
 * vieja nunca queda atendiendo a la nueva. Ver también aviso-version.tsx.
 */
export const ACTUALIZACION = { skipWaiting: true, clientsClaim: true } as const;

/** Si una URL puede guardarse en el teléfono. Sólo estáticos y la pantalla
 *  sin conexión; nunca `/api/**` ni otro HTML. */
export function sePuedeGuardar(url: string): boolean {
  // La ruta, sin origen, consulta ni ancla (las entradas del manifiesto son
  // relativas; las del service worker, absolutas).
  const pathname = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split(/[?#]/)[0];
  return pathname.startsWith(PREFIJO_ESTATICOS) || pathname === RUTA_SIN_CONEXION;
}

/** La lista de precarga, filtrada por la regla aunque el build trajera algo
 *  más (una carpeta `public/` nueva, por ejemplo). */
export function precargaPermitida<T extends string | { url: string }>(entradas: readonly T[] | undefined): T[] {
  return (entradas ?? []).filter((e) => sePuedeGuardar(typeof e === "string" ? e : e.url));
}

/** Una navegación de página (abrir la app, tocar un enlace que recarga). Las
 *  únicas peticiones que el service worker atiende fuera de la precarga, y
 *  las atiende yendo a la red sin guardar nada. */
export function esNavegacion({ request }: { request: { mode: string; method: string } }): boolean {
  return request.mode === "navigate" && request.method === "GET";
}
