import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
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
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return Response.json({ error: "Error interno" }, { status: 500 });
}
