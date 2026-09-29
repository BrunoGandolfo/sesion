import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /**
     * Código estable para que el cliente distinga ESTE error de otro con el
     * mismo status, sin leer el texto. Opcional: los errores que ya existían
     * no lo llevan y su cuerpo no cambia (`{ error }` a secas).
     */
    public readonly codigo?: string,
  ) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200) {
  return Response.json({ data }, { status });
}

/**
 * `ok` con `Cache-Control: no-store`: para lo que no puede quedar en ninguna
 * caché intermedia ni del navegador. Lo usan las rutas de la cuenta (cookie
 * de sesión, quién está entrada), el Recorrido y el brief (texto clínico) y
 * /api/version (tiene que ver el build de ahora). Es el ÚNICO lugar que
 * escribe esa cabecera en src/app/api.
 */
export function okSinCache<T>(data: T, status = 200) {
  const respuesta = ok(data, status);
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}

export function validationError(error: ZodError) {
  return Response.json(
    { error: "Datos inválidos", details: error.flatten() },
    { status: 400 },
  );
}

/** Lo que contesta una ruta cuando el cuerpo no es JSON. */
export const MENSAJE_JSON_INVALIDO = "JSON inválido";

/**
 * El cuerpo del pedido como JSON, o 400 "JSON inválido". Las rutas leen el
 * cuerpo con esto y no con `request.json()` pelado
 * (json-invalido-rutas.test.ts lo exige).
 *
 * Antes `request.json()` lanzaba `SyntaxError`, errorResponse no lo conocía
 * y 23 rutas contestaban 500: un error de quien pide quedaba como error del
 * servidor, ensuciaba el log y, en las rutas del worker, el 5xx lo hacía
 * reintentar algo que nunca iba a pasar.
 *
 * La traducción es acá, en el borde, y no en errorResponse con un
 * `instanceof SyntaxError`: el servidor también hace `JSON.parse` de campos
 * guardados (prisma-encryption.ts parsea lo descifrado), y un dato roto en
 * la base tiene que seguir siendo un 500 con log, no un 400 que culpa al
 * cliente.
 */
export async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError(MENSAJE_JSON_INVALIDO, 400);
    throw error;
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return validationError(error);
  }

  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, ...(error.codigo ? { codigo: error.codigo } : {}) },
      { status: error.status },
    );
  }

  console.error(error);
  return Response.json({ error: "Error interno" }, { status: 500 });
}
