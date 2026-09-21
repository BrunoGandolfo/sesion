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

export function validationError(error: ZodError) {
  return Response.json(
    { error: "Datos inválidos", details: error.flatten() },
    { status: 400 },
  );
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
