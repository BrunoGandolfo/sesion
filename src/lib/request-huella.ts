// De quién vino un request: IP y user-agent. Módulo puro (sólo lee headers).
//
// Existía copiado dentro de la ruta de consentimiento (getIpOrigen). Ahora lo
// usan esa ruta y la auditoría del login, y la forma de leer el header es una
// sola: detrás de un proxy —Vercel lo es— la IP del cliente viaja en
// `x-forwarded-for` como una lista "cliente, proxy1, proxy2", y la primera
// es la única que dice algo del cliente.

/** Cuánto se guarda del user-agent. Los navegadores mandan cadenas larguísimas
 *  y lo que interesa es reconocer el dispositivo, no archivarlo entero. */
export const USER_AGENT_MAX = 120;

export interface HuellaRequest {
  /** IP del cliente, o `null` si el proxy no la mandó. */
  ip: string | null;
  /** User-agent recortado, o `null` si no vino. */
  userAgent: string | null;
}

export function ipDeRequest(request: Request | null | undefined): string | null {
  if (!request) return null;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [primera] = forwardedFor.split(",");
    const ip = primera?.trim();
    if (ip) return ip;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp ? realIp : null;
}

export function userAgentDeRequest(
  request: Request | null | undefined,
): string | null {
  const ua = request?.headers.get("user-agent")?.trim();
  if (!ua) return null;
  return ua.length > USER_AGENT_MAX ? ua.slice(0, USER_AGENT_MAX) : ua;
}

export function huellaDeRequest(
  request: Request | null | undefined,
): HuellaRequest {
  return { ip: ipDeRequest(request), userAgent: userAgentDeRequest(request) };
}
