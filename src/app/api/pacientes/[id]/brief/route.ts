// Brief pre-sesión ("Para retomar"): composición DETERMINÍSTICA de datos ya
// persistidos — sin LLM, sin processor. La psicóloga lo lee 1 minuto antes de
// que entre el paciente.
//
// Fuentes:
//   - ultimaSesion: última sesión aprobada (fallback: revision, marcada
//     pendienteAprobacion) → datosEstructurados de esa nota.
//   - hiloLongitudinal: PacienteContextoClinico (Golden Thread).
//   - proximoTurno: próximo turno programado.

import { db } from "@/lib/db";
import { normalizarRiesgo } from "@/types/domain";
import type { DatosEstructurados, NivelRiesgo } from "@/types/domain";

import { getOrganizationId } from "../../../_lib/auth";
import { ApiError, errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const FLAG_KEYS = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
] as const;

const TOP_TEMAS_RECURRENTES = 3;

interface Objetivo {
  id: string;
  descripcion: string;
  estado: "activo" | "cerrado" | "pausado";
}

interface Tema {
  tema: string;
  conteo: number;
}

interface RiesgoHistorico {
  sesionId: string;
  fecha: string;
  flag: string;
  detalle?: string;
}

// La extensión de cifrado descifra datosEstructuradosEncrypted a objeto, pero
// filas legacy pueden traer el string JSON crudo. Mismo criterio que
// documentacion/route.ts.
function parseDatos(raw: unknown): Partial<DatosEstructurados> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Partial<DatosEstructurados>;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Partial<DatosEstructurados>;
  return null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// riesgosHistoricos: la extensión lo re-parsea a array al leer, pero una fila
// legacy (columna en texto plano) puede llegar como string JSON.
function parseRiesgosHistoricos(raw: unknown): RiesgoHistorico[] {
  if (typeof raw === "string") {
    try {
      return asArray<RiesgoHistorico>(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return asArray<RiesgoHistorico>(raw);
}

interface UltimaSesionBrief {
  fecha: string;
  pendienteAprobacion: boolean;
  resumenSesion: string | null;
  focoProximaSesion: string | null;
  progresoPercibido: string | null;
  temas: string[];
  riesgo: {
    flagsActivos: string[];
    nivel: NivelRiesgo;
    indicadores: string[];
    notaParaTerapeuta: string | null;
  };
}

async function cargarUltimaSesion(
  organizationId: string,
  pacienteId: string,
): Promise<UltimaSesionBrief | null> {
  const select = {
    estado: true,
    datosEstructurados: true,
    turno: { select: { fecha: true } },
  } as const;

  const aprobada = await db.sesionClinica.findFirst({
    where: { organizationId, estado: "aprobado", turno: { pacienteId } },
    orderBy: { turno: { fecha: "desc" } },
    select,
  });
  const sesion =
    aprobada ??
    (await db.sesionClinica.findFirst({
      where: { organizationId, estado: "revision", turno: { pacienteId } },
      orderBy: { turno: { fecha: "desc" } },
      select,
    }));

  if (!sesion) return null;

  const datos = parseDatos(sesion.datosEstructurados as unknown);
  const flagsActivos = FLAG_KEYS.filter(
    (key) => datos?.flagsRiesgo?.[key] === true,
  );
  const riesgo = normalizarRiesgo(datos?.riesgoDetectado);

  return {
    fecha: sesion.turno.fecha.toISOString(),
    pendienteAprobacion: sesion.estado === "revision",
    resumenSesion:
      typeof datos?.resumenSesion === "string" ? datos.resumenSesion : null,
    focoProximaSesion:
      typeof datos?.focoProximaSesion === "string"
        ? datos.focoProximaSesion
        : null,
    progresoPercibido:
      typeof datos?.progresoPercibido === "string"
        ? datos.progresoPercibido
        : null,
    temas: Array.isArray(datos?.temas)
      ? datos.temas.filter((t): t is string => typeof t === "string")
      : [],
    riesgo: {
      flagsActivos: [...flagsActivos],
      nivel: riesgo.nivel,
      indicadores: riesgo.indicadores,
      notaParaTerapeuta: riesgo.notaParaTerapeuta,
    },
  };
}

interface HiloLongitudinalBrief {
  resumenAcumulativo: string | null;
  hipotesisDiagnostica: string | null;
  temasRecurrentes: Tema[];
  objetivosActivos: string[];
  riesgosHistoricos: RiesgoHistorico[];
  revisadoPorTerapeuta: boolean;
}

async function cargarHilo(
  organizationId: string,
  pacienteId: string,
): Promise<HiloLongitudinalBrief | null> {
  const contexto = await db.pacienteContextoClinico.findUnique({
    where: { pacienteId },
    select: {
      hipotesisDiagnostica: true,
      resumenAcumulativo: true,
      temasRecurrentes: true,
      objetivosTerapeuticos: true,
      riesgosHistoricos: true,
      aprobadoPorTerapeutaEn: true,
      organizationId: true,
    },
  });

  if (!contexto) return null;
  // Misma defensa que contexto-clinico/route.ts: el findUnique no scopea por
  // org; el FK al paciente debería garantizarlo, pero verificamos igual.
  if (contexto.organizationId !== organizationId) {
    throw new ApiError("Contexto pertenece a otra organización", 403);
  }

  const temasRecurrentes = asArray<Tema>(contexto.temasRecurrentes)
    .filter((t) => t && typeof t.tema === "string")
    .sort((a, b) => (b.conteo ?? 0) - (a.conteo ?? 0))
    .slice(0, TOP_TEMAS_RECURRENTES);

  const objetivosActivos = asArray<Objetivo>(contexto.objetivosTerapeuticos)
    .filter((o) => o && o.estado === "activo" && typeof o.descripcion === "string")
    .map((o) => o.descripcion);

  return {
    resumenAcumulativo: contexto.resumenAcumulativo ?? null,
    hipotesisDiagnostica: contexto.hipotesisDiagnostica ?? null,
    temasRecurrentes,
    objetivosActivos,
    riesgosHistoricos: parseRiesgosHistoricos(contexto.riesgosHistoricos),
    revisadoPorTerapeuta: contexto.aprobadoPorTerapeutaEn !== null,
  };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id: pacienteId } = await params;

    const paciente = await db.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { id: true },
    });
    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const [ultimaSesion, hiloLongitudinal, proximoTurno] = await Promise.all([
      cargarUltimaSesion(organizationId, pacienteId),
      cargarHilo(organizationId, pacienteId),
      db.turno.findFirst({
        where: {
          organizationId,
          pacienteId,
          estado: "programado",
          fecha: { gte: new Date() },
        },
        orderBy: { fecha: "asc" },
        select: { fecha: true, duracion: true, modalidad: true },
      }),
    ]);

    return ok({
      pacienteId,
      ultimaSesion,
      hiloLongitudinal,
      proximoTurno: proximoTurno
        ? {
            fecha: proximoTurno.fecha.toISOString(),
            duracion: proximoTurno.duracion,
            modalidad: proximoTurno.modalidad,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
