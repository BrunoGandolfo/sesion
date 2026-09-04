// Cliente mínimo para la API interna (/api/**) desde el navegador.
//
// Refleja el contrato de src/app/api/_lib/responses.ts:
//   - ok(data)            → 2xx con { data }
//   - errorResponse(err)  → { error: string }
//   - validationError(e)  → 400 con { error: "Datos inválidos", details }
//
// Sin reintentos, sin cache, sin interceptores: si mañana hacen falta, se
// agregan cuando haya tres consumidores que lo pidan.

export interface OpcionesApi {
  signal?: AbortSignal;
}

const MENSAJE_GENERICO = "No pudimos completar la operación. Intentá de nuevo.";

/** Respuesta no-ok de la API. `message` (y su alias `mensaje`) trae el
 *  `error` del body cuando existe; `details` es el `details` de un 400 de
 *  validación, o undefined. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(mensaje: string, status: number, details?: unknown) {
    super(mensaje);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }

  get mensaje(): string {
    return this.message;
  }

  get esNoEncontrado(): boolean {
    return this.status === 404;
  }

  get esNoAutorizado(): boolean {
    return this.status === 401;
  }
}

/** True para el AbortError que lanza fetch cuando se aborta el signal
 *  (DOMException en el navegador, Error con name "AbortError" en Node). */
export function esAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

async function leerJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function lanzarSiNoOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await leerJson(res);
  const mensaje =
    esObjeto(body) && typeof body.error === "string"
      ? body.error
      : MENSAJE_GENERICO;
  const details = esObjeto(body) && "details" in body ? body.details : undefined;
  throw new ApiClientError(mensaje, res.status, details);
}

async function desenvolver<T>(res: Response): Promise<T> {
  await lanzarSiNoOk(res);
  // Los abort llegan como excepción de fetch antes de este punto y se
  // propagan sin envolver.
  const body = (await res.json()) as { data: T };
  return body.data;
}

export async function apiGet<T>(
  path: string,
  opciones: OpcionesApi = {},
): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    cache: "no-store",
    signal: opciones.signal,
  });
  return desenvolver<T>(res);
}

async function conCuerpo<T>(
  metodo: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  opciones: OpcionesApi,
): Promise<T> {
  const res = await fetch(path, {
    method: metodo,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opciones.signal,
  });
  return desenvolver<T>(res);
}

export function apiPost<T>(
  path: string,
  body: unknown,
  opciones: OpcionesApi = {},
): Promise<T> {
  return conCuerpo<T>("POST", path, body, opciones);
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  opciones: OpcionesApi = {},
): Promise<T> {
  return conCuerpo<T>("PATCH", path, body, opciones);
}

export function apiDelete<T>(
  path: string,
  body: unknown = undefined,
  opciones: OpcionesApi = {},
): Promise<T> {
  return conCuerpo<T>("DELETE", path, body, opciones);
}
