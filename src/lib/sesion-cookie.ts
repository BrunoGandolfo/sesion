// La cookie de sesión y las rutas públicas. Módulo PURO: ni base, ni Node,
// ni glosario. Lo importan el proxy (src/proxy.ts) y las rutas de cuenta, y
// es lo único —junto con @/lib/csp— que el proxy puede importar
// (proxy-liviano.test.ts lo fija).
//
// LA COOKIE
//
// Valor: 32 bytes aleatorios en base64url (43 caracteres). El servidor guarda
// solo su sha256 en sesiones_acceso. Nombre `__Host-sesion` en producción: el
// prefijo __Host- obliga a Secure, Path=/ y sin Domain, así la cookie queda
// atada al dominio exacto y un subdominio no puede fijarla. En desarrollo
// (http://localhost) el prefijo no es válido, así que se llama `sesion`.
//
// HttpOnly (JavaScript no la lee), Secure en producción, SameSite=Lax (un
// formulario ajeno no la manda; la segunda capa contra CSRF es el chequeo de
// Origin de esOrigenPropio), Max-Age de 30 días (el vencimiento absoluto que
// además guarda la fila).

export const NOMBRE_COOKIE_PRODUCCION = "__Host-sesion";
export const NOMBRE_COOKIE_DESARROLLO = "sesion";

/** Vigencia absoluta de una sesión: 30 días. */
export const VIGENCIA_SESION_SEGUNDOS = 30 * 24 * 60 * 60;

/** 32 bytes en base64url, sin padding. */
export const TOKEN_SESION = /^[A-Za-z0-9_-]{43}$/;

export function esProduccion(): boolean {
  return process.env.NODE_ENV === "production";
}

export function nombreCookie(produccion: boolean = esProduccion()): string {
  return produccion ? NOMBRE_COOKIE_PRODUCCION : NOMBRE_COOKIE_DESARROLLO;
}

/** Cabecera Set-Cookie que abre la sesión. */
export function cookieDeSesion(token: string, produccion: boolean = esProduccion()): string {
  const partes = [
    `${nombreCookie(produccion)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VIGENCIA_SESION_SEGUNDOS}`,
  ];
  if (produccion) partes.push("Secure");
  return partes.join("; ");
}

/** Cabecera Set-Cookie que la borra (Max-Age=0). */
export function cookieBorrada(produccion: boolean = esProduccion()): string {
  const partes = [`${nombreCookie(produccion)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (produccion) partes.push("Secure");
  return partes.join("; ");
}

/** El token de la cabecera Cookie, o null si no viene o no tiene la forma. */
export function tokenDeCookieHeader(
  header: string | null | undefined,
  nombre: string = nombreCookie(),
): string | null {
  if (!header) return null;
  for (const par of header.split(";")) {
    const i = par.indexOf("=");
    if (i < 0) continue;
    if (par.slice(0, i).trim() !== nombre) continue;
    const valor = par.slice(i + 1).trim();
    return TOKEN_SESION.test(valor) ? valor : null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Rutas públicas: las que se pueden abrir sin sesión. Coincidencia exacta.
// ────────────────────────────────────────────────────────────────────────────

export const RUTAS_PUBLICAS: readonly string[] = [
  "/login",
  "/registro",
  "/terminos",
  "/recuperar",
  "/restablecer",
  "/api/cuenta/entrar",
  "/api/cuenta/registro",
  "/api/cuenta/recuperar",
  "/api/cuenta/restablecer",
];

export function esRutaPublica(pathname: string): boolean {
  return RUTAS_PUBLICAS.includes(pathname);
}

// ────────────────────────────────────────────────────────────────────────────
// Origen propio (CSRF): un pedido que cambia estado tiene que venir del
// propio sitio. SameSite=Lax ya impide que un formulario ajeno mande la
// cookie; esto es la segunda capa, y cubre el caso de un navegador viejo.
//
// Regla: para métodos distintos de GET/HEAD/OPTIONS, si viene `Origin`, su
// host tiene que ser el nuestro; si no viene Origin, `Sec-Fetch-Site` tiene
// que ser same-origin/same-site/none (o no venir: cliente sin la cabecera,
// como una request de servidor a servidor). `cross-site` se rechaza.
// ────────────────────────────────────────────────────────────────────────────

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export function esMetodoSeguro(metodo: string): boolean {
  return METODOS_SEGUROS.has(metodo.toUpperCase());
}

export function esOrigenPropio(
  metodo: string,
  headers: { get(nombre: string): string | null },
  hostPropio: string | null,
): boolean {
  if (esMetodoSeguro(metodo)) return true;

  const origin = headers.get("origin");
  if (origin) {
    if (!hostPropio) return false;
    try {
      return new URL(origin).host === hostPropio;
    } catch {
      return false;
    }
  }

  const sitio = headers.get("sec-fetch-site");
  return sitio === null || sitio === "same-origin" || sitio === "same-site" || sitio === "none";
}
