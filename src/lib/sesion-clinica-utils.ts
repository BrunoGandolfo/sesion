import type {
  AlianzaTerapeutica,
  DatosEstructurados,
  EstadoProcesamiento,
  NotaSOAP,
} from "@/types/domain";

// Mantener sincronizado con el endpoint PATCH /api/sesion-clinica/[id].
// revision/aprobado no transicionan vía PATCH: aprobado se setea en el
// endpoint dedicado /aprobar.
const TRANSICIONES_PERMITIDAS: Record<
  EstadoProcesamiento,
  ReadonlyArray<EstadoProcesamiento>
> = {
  pendiente: ["grabando"],
  grabando: ["subiendo"],
  subiendo: ["procesando"],
  procesando: ["revision", "error"],
  revision: [],
  aprobado: [],
  error: ["procesando"],
};

export function esTransicionValida(
  estadoActual: EstadoProcesamiento,
  estadoNuevo: EstadoProcesamiento,
): boolean {
  return TRANSICIONES_PERMITIDAS[estadoActual].includes(estadoNuevo);
}

const ALIANZAS_VALIDAS: ReadonlyArray<AlianzaTerapeutica> = [
  "fragil",
  "inestable",
  "estable",
  "fuerte",
];

function esAlianzaValida(value: unknown): value is AlianzaTerapeutica {
  return (
    typeof value === "string" &&
    (ALIANZAS_VALIDAS as ReadonlyArray<string>).includes(value)
  );
}

function esArrayDeStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function parseDatosEstructurados(
  json: string | null,
): DatosEstructurados | null {
  if (json === null) return null;
  if (json.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const intensidad = obj.intensidadEmocional;
  if (
    typeof intensidad !== "number" ||
    !Number.isFinite(intensidad) ||
    intensidad < 1 ||
    intensidad > 10
  ) {
    return null;
  }

  if (!esAlianzaValida(obj.alianzaTerapeutica)) return null;
  if (!esArrayDeStrings(obj.temas)) return null;
  if (!esArrayDeStrings(obj.emocionesPaciente)) return null;
  if (!esArrayDeStrings(obj.intervenciones)) return null;
  if (!esArrayDeStrings(obj.compromisos)) return null;
  if (!esArrayDeStrings(obj.senalesAlerta)) return null;
  if (typeof obj.progresoPercibido !== "string") return null;

  return {
    temas: obj.temas,
    emocionesPaciente: obj.emocionesPaciente,
    intensidadEmocional: intensidad,
    alianzaTerapeutica: obj.alianzaTerapeutica,
    intervenciones: obj.intervenciones,
    compromisos: obj.compromisos,
    senalesAlerta: obj.senalesAlerta,
    progresoPercibido: obj.progresoPercibido,
  };
}

export function esNotaCompleta(nota: Partial<NotaSOAP>): boolean {
  return Boolean(
    nota.subjetivo?.trim() &&
      nota.objetivo?.trim() &&
      nota.analisis?.trim() &&
      nota.plan?.trim(),
  );
}
