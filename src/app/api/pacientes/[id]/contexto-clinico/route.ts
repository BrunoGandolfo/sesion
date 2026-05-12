// Endpoint del Golden Thread.
//
// GET acepta dos modos de auth:
//   - Bearer PROCESSING_SECRET (M2M): para el worker Python que prepara el
//     contexto antes de llamar al LLM.
//   - Sesión next-auth (UI): para que la terapeuta vea/edite el contexto.
//
// Por la auth M2M, este path está excluido del matcher de middleware
// (src/middleware.ts) — la auth se hace en la propia ruta.
//
// PATCH es sólo session: actualizar el contexto es una acción clínica que
// requiere humano, no la queremos automatizar desde el worker.

import { z } from "zod";

import { db } from "@/lib/db";

import { getOrganizationId } from "../../../_lib/auth";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const LLM_FORMAT_QUERY = "format";
const LLM_FORMAT_VALUE = "llm";
const ULTIMAS_NOTAS_LIMIT = 3;

// ────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ────────────────────────────────────────────────────────────────────────────

function isM2MAuthorized(request: Request): boolean {
  const secret = process.env.PROCESSING_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

type AuthResult =
  | { kind: "m2m" }
  | { kind: "session"; organizationId: string };

/**
 * Resuelve la auth para GET: primero intenta Bearer (cheaper), después sesión.
 * El M2M caller no tiene organizationId — el scoping se hace por el paciente
 * que el worker pidió. El session caller queda scopeado por su org.
 */
async function authorizeRead(request: Request): Promise<AuthResult> {
  if (isM2MAuthorized(request)) {
    return { kind: "m2m" };
  }
  const organizationId = await getOrganizationId();
  return { kind: "session", organizationId };
}

// ────────────────────────────────────────────────────────────────────────────
// Tipos del payload (defaults para pacientes sin contexto todavía)
// ────────────────────────────────────────────────────────────────────────────

interface Objetivo {
  id: string;
  descripcion: string;
  estado: "activo" | "cerrado" | "pausado";
  fechaInicio: string;
  fechaCierre?: string | null;
}

interface Intervencion {
  tecnica: string;
  eficaciaPercibida: "alta" | "media" | "baja";
  sesiones: number[];
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

interface ContextoPayload {
  pacienteId: string;
  hipotesisDiagnostica: string | null;
  resumenAcumulativo: string | null;
  objetivosTerapeuticos: Objetivo[];
  intervencionesProbadas: Intervencion[];
  temasRecurrentes: Tema[];
  riesgosHistoricos: RiesgoHistorico[];
  ultimaSesionId: string | null;
  version: number;
  aprobadoPorTerapeutaEn: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
  // Notas históricas adjuntas (solo presentes en la response — no se persisten
  // acá). Las usa el worker para inyectar A+P de las últimas 3 sesiones al
  // prompt sin tener que hacer otra llamada.
  ultimasNotas: NotaResumen[];
  totalSesionesAprobadas: number;
}

interface NotaResumen {
  sesionClinicaId: string;
  numero: number; // posición DESC: 1 = más reciente
  fechaSesion: string;
  notaAnalisis: string | null;
  notaPlan: string | null;
}

function payloadVacio(pacienteId: string): ContextoPayload {
  return {
    pacienteId,
    hipotesisDiagnostica: null,
    resumenAcumulativo: null,
    objetivosTerapeuticos: [],
    intervencionesProbadas: [],
    temasRecurrentes: [],
    riesgosHistoricos: [],
    ultimaSesionId: null,
    version: 0,
    aprobadoPorTerapeutaEn: null,
    creadoEn: null,
    actualizadoEn: null,
    ultimasNotas: [],
    totalSesionesAprobadas: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Casts de Json crudo de Prisma a los tipos de arriba.
//
// Prisma devuelve `Prisma.JsonValue` para columnas Json. La forma la garantiza
// la spec del modelo + el Zod del PATCH; en GET asumimos consistencia y caemos
// a array vacío si la forma se rompe (datos corruptos en DB).
// ────────────────────────────────────────────────────────────────────────────

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// ────────────────────────────────────────────────────────────────────────────
// Resolver paciente y armar el payload (compartido entre formato JSON y LLM)
// ────────────────────────────────────────────────────────────────────────────

async function resolverPaciente(
  pacienteId: string,
  auth: AuthResult,
): Promise<{ organizationId: string }> {
  // M2M confía en el caller pero igual valida que el paciente exista
  // (el worker no debería pedir contexto de un id inventado).
  const where =
    auth.kind === "m2m"
      ? { id: pacienteId }
      : { id: pacienteId, organizationId: auth.organizationId };

  const paciente = await db.paciente.findFirst({
    where,
    select: { id: true, organizationId: true },
  });

  if (!paciente) {
    throw new ApiError("Paciente no encontrado", 404);
  }

  return { organizationId: paciente.organizationId };
}

async function cargarContexto(
  pacienteId: string,
  organizationId: string,
): Promise<ContextoPayload> {
  const [contextoRaw, ultimasNotas, totalAprobadas] = await Promise.all([
    db.pacienteContextoClinico.findUnique({
      where: { pacienteId },
      select: {
        hipotesisDiagnostica: true,
        resumenAcumulativo: true,
        objetivosTerapeuticos: true,
        intervencionesProbadas: true,
        temasRecurrentes: true,
        riesgosHistoricos: true,
        ultimaSesionId: true,
        version: true,
        aprobadoPorTerapeutaEn: true,
        creadoEn: true,
        actualizadoEn: true,
        organizationId: true,
      },
    }),
    db.sesionClinica.findMany({
      where: {
        organizationId,
        estado: "aprobado",
        turno: { pacienteId },
      },
      orderBy: { turno: { fecha: "desc" } },
      take: ULTIMAS_NOTAS_LIMIT,
      select: {
        id: true,
        notaAnalisis: true,
        notaPlan: true,
        turno: { select: { fecha: true } },
      },
    }),
    db.sesionClinica.count({
      where: {
        organizationId,
        estado: "aprobado",
        turno: { pacienteId },
      },
    }),
  ]);

  // Defensa: si el contexto está en otra org (no debería ocurrir porque el
  // findUnique no scopea por org; el FK al paciente lo garantiza), abortar.
  if (contextoRaw && contextoRaw.organizationId !== organizationId) {
    throw new ApiError("Contexto pertenece a otra organización", 403);
  }

  const notasResumen: NotaResumen[] = ultimasNotas.map((s, idx) => ({
    sesionClinicaId: s.id,
    numero: idx + 1,
    fechaSesion: s.turno.fecha.toISOString(),
    notaAnalisis: s.notaAnalisis ?? null,
    notaPlan: s.notaPlan ?? null,
  }));

  if (!contextoRaw) {
    const vacio = payloadVacio(pacienteId);
    vacio.ultimasNotas = notasResumen;
    vacio.totalSesionesAprobadas = totalAprobadas;
    return vacio;
  }

  return {
    pacienteId,
    hipotesisDiagnostica: contextoRaw.hipotesisDiagnostica ?? null,
    resumenAcumulativo: contextoRaw.resumenAcumulativo ?? null,
    objetivosTerapeuticos: asArray<Objetivo>(contextoRaw.objetivosTerapeuticos),
    intervencionesProbadas: asArray<Intervencion>(
      contextoRaw.intervencionesProbadas,
    ),
    temasRecurrentes: asArray<Tema>(contextoRaw.temasRecurrentes),
    riesgosHistoricos: asArray<RiesgoHistorico>(contextoRaw.riesgosHistoricos),
    ultimaSesionId: contextoRaw.ultimaSesionId,
    version: contextoRaw.version,
    aprobadoPorTerapeutaEn:
      contextoRaw.aprobadoPorTerapeutaEn?.toISOString() ?? null,
    creadoEn: contextoRaw.creadoEn.toISOString(),
    actualizadoEn: contextoRaw.actualizadoEn.toISOString(),
    ultimasNotas: notasResumen,
    totalSesionesAprobadas: totalAprobadas,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Formato Markdown para inyectar al prompt del LLM.
//
// Objetivos de diseño:
//   - Compacto: el contexto debe caber en ~3K tokens para dejar espacio a
//     la transcripción de 90 min (~6-8K) en una ventana de 16K.
//   - Sin ruido: secciones vacías se renderizan como "—" en lugar de
//     bloques en blanco, para que el LLM no las trate como "información
//     suprimida".
//   - Sólo A + P de las notas previas (no S + O): es donde vive la
//     interpretación clínica que importa para continuidad.
// ────────────────────────────────────────────────────────────────────────────

function formatearLLM(payload: ContextoPayload): string {
  const activos = payload.objetivosTerapeuticos.filter(
    (o) => o.estado === "activo",
  );
  const cerrados = payload.objetivosTerapeuticos.filter(
    (o) => o.estado === "cerrado",
  );

  const lines: string[] = [];
  lines.push("## Contexto longitudinal del paciente");
  lines.push("");
  lines.push(
    `**Total de sesiones aprobadas previas**: ${payload.totalSesionesAprobadas}`,
  );
  if (payload.actualizadoEn) {
    lines.push(
      `**Última actualización del contexto**: ${payload.actualizadoEn.slice(0, 10)} (v${payload.version})`,
    );
  }
  if (payload.aprobadoPorTerapeutaEn) {
    lines.push(
      `**Revisado por la terapeuta**: ${payload.aprobadoPorTerapeutaEn.slice(0, 10)}`,
    );
  } else if (payload.version > 0) {
    lines.push("**Revisado por la terapeuta**: pendiente");
  }

  if (payload.version === 0 && payload.totalSesionesAprobadas === 0) {
    lines.push("");
    lines.push(
      "_Primer ciclo del Golden Thread: no hay contexto previo ni sesiones aprobadas._",
    );
    return lines.join("\n");
  }

  lines.push("");
  lines.push("### Hipótesis diagnóstica de trabajo");
  lines.push(payload.hipotesisDiagnostica?.trim() || "—");

  lines.push("");
  lines.push("### Objetivos terapéuticos activos");
  if (activos.length === 0) {
    lines.push("—");
  } else {
    for (const o of activos) {
      const inicio = o.fechaInicio.slice(0, 10);
      lines.push(`- [activo desde ${inicio}] ${o.descripcion}`);
    }
  }

  if (cerrados.length > 0) {
    lines.push("");
    lines.push("### Objetivos cerrados (referencia)");
    for (const o of cerrados) {
      const cierre = (o.fechaCierre ?? "").slice(0, 10);
      lines.push(
        `- [cerrado${cierre ? ` ${cierre}` : ""}] ${o.descripcion}`,
      );
    }
  }

  lines.push("");
  lines.push("### Resumen acumulativo");
  lines.push(payload.resumenAcumulativo?.trim() || "—");

  lines.push("");
  lines.push("### Temas recurrentes");
  if (payload.temasRecurrentes.length === 0) {
    lines.push("—");
  } else {
    const ordenados = [...payload.temasRecurrentes].sort(
      (a, b) => b.conteo - a.conteo,
    );
    for (const t of ordenados) {
      lines.push(`- ${t.tema} (${t.conteo})`);
    }
  }

  lines.push("");
  lines.push("### Intervenciones probadas");
  if (payload.intervencionesProbadas.length === 0) {
    lines.push("—");
  } else {
    for (const i of payload.intervencionesProbadas) {
      lines.push(
        `- ${i.tecnica}: eficacia ${i.eficaciaPercibida} (${i.sesiones.length} sesiones)`,
      );
    }
  }

  if (payload.riesgosHistoricos.length > 0) {
    lines.push("");
    lines.push("### Riesgos históricos");
    const ordenados = [...payload.riesgosHistoricos].sort((a, b) =>
      a.fecha < b.fecha ? 1 : -1,
    );
    for (const r of ordenados) {
      const fecha = r.fecha.slice(0, 10);
      const detalle = r.detalle ? ` — ${r.detalle}` : "";
      lines.push(`- ${fecha}: ${r.flag}${detalle}`);
    }
  }

  lines.push("");
  lines.push(
    `### Últimas ${payload.ultimasNotas.length} sesión(es) aprobada(s) — Análisis + Plan`,
  );
  if (payload.ultimasNotas.length === 0) {
    lines.push("Sin sesiones aprobadas previas.");
  } else {
    for (const n of payload.ultimasNotas) {
      const fecha = n.fechaSesion.slice(0, 10);
      lines.push("");
      lines.push(`#### Sesión del ${fecha}`);
      lines.push("");
      lines.push("**A (Análisis):**");
      lines.push(n.notaAnalisis?.trim() || "—");
      lines.push("");
      lines.push("**P (Plan):**");
      lines.push(n.notaPlan?.trim() || "—");
    }
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// GET — devuelve el contexto, en JSON o en Markdown para LLM
// ────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await authorizeRead(request);
    const { id: pacienteId } = await params;
    const { organizationId } = await resolverPaciente(pacienteId, auth);

    const payload = await cargarContexto(pacienteId, organizationId);

    const url = new URL(request.url);
    if (url.searchParams.get(LLM_FORMAT_QUERY) === LLM_FORMAT_VALUE) {
      const markdown = formatearLLM(payload);
      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return ok(payload);
  } catch (error) {
    return errorResponse(error);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PATCH — actualiza el contexto. Sólo sesión next-auth.
//
// Upsert: si no existe, lo crea. Si existe, mergea sólo los campos enviados
// y bumpea `version`. Cada PATCH humano se considera revisión clínica, así
// que también seteamos `aprobadoPorTerapeutaEn = now()` automáticamente.
//
// Nota: las actualizaciones automáticas generadas por el worker
// (post-aprobación de una sesión) viven en otro endpoint dedicado — ese path
// permanece M2M y deja `aprobadoPorTerapeutaEn = null` para que la terapeuta
// vea el badge "sugerencia pendiente". Acá NO entran esos updates.
// ────────────────────────────────────────────────────────────────────────────

const objetivoSchema = z.object({
  id: z.string().min(1),
  descripcion: z.string().min(1),
  estado: z.enum(["activo", "cerrado", "pausado"]),
  fechaInicio: z.string().min(1),
  fechaCierre: z.string().nullable().optional(),
});

const intervencionSchema = z.object({
  tecnica: z.string().min(1),
  eficaciaPercibida: z.enum(["alta", "media", "baja"]),
  sesiones: z.array(z.number().int().nonnegative()),
});

const temaSchema = z.object({
  tema: z.string().min(1),
  conteo: z.number().int().nonnegative(),
});

const riesgoSchema = z.object({
  sesionId: z.string().min(1),
  fecha: z.string().min(1),
  flag: z.string().min(1),
  detalle: z.string().optional(),
});

const updateSchema = z
  .object({
    hipotesisDiagnostica: z.string().nullable().optional(),
    resumenAcumulativo: z.string().nullable().optional(),
    objetivosTerapeuticos: z.array(objetivoSchema).optional(),
    intervencionesProbadas: z.array(intervencionSchema).optional(),
    temasRecurrentes: z.array(temaSchema).optional(),
    riesgosHistoricos: z.array(riesgoSchema).optional(),
    ultimaSesionId: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Falta al menos un campo para actualizar",
  });

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    // PATCH es session-only — no aceptamos M2M acá.
    const organizationId = await getOrganizationId();
    const { id: pacienteId } = await params;

    const paciente = await db.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { id: true },
    });
    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const body = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const ahora = new Date();
    const data = parsed.data;

    // Para upsert necesitamos saber si existe (para bumpear version).
    const existente = await db.pacienteContextoClinico.findUnique({
      where: { pacienteId },
      select: { id: true, version: true },
    });

    const updateData: Record<string, unknown> = {
      aprobadoPorTerapeutaEn: ahora,
      version: (existente?.version ?? 0) + 1,
    };
    if (data.hipotesisDiagnostica !== undefined) {
      updateData.hipotesisDiagnostica = data.hipotesisDiagnostica;
    }
    if (data.resumenAcumulativo !== undefined) {
      updateData.resumenAcumulativo = data.resumenAcumulativo;
    }
    if (data.objetivosTerapeuticos !== undefined) {
      updateData.objetivosTerapeuticos = data.objetivosTerapeuticos;
    }
    if (data.intervencionesProbadas !== undefined) {
      updateData.intervencionesProbadas = data.intervencionesProbadas;
    }
    if (data.temasRecurrentes !== undefined) {
      updateData.temasRecurrentes = data.temasRecurrentes;
    }
    if (data.riesgosHistoricos !== undefined) {
      // Lo stringificamos antes de pasarlo a Prisma para satisfacer el tipo
      // generado (la columna es String? @db.Text). La extensión de cifrado
      // acepta strings y los cifra tal cual; al leer reparses a array.
      // Mismo patrón que callback/route.ts con datosEstructurados.
      updateData.riesgosHistoricos = JSON.stringify(data.riesgosHistoricos);
    }
    if (data.ultimaSesionId !== undefined) {
      updateData.ultimaSesionId = data.ultimaSesionId;
    }

    await db.pacienteContextoClinico.upsert({
      where: { pacienteId },
      update: updateData,
      create: {
        pacienteId,
        organizationId,
        hipotesisDiagnostica: data.hipotesisDiagnostica ?? null,
        resumenAcumulativo: data.resumenAcumulativo ?? null,
        objetivosTerapeuticos: data.objetivosTerapeuticos ?? [],
        intervencionesProbadas: data.intervencionesProbadas ?? [],
        temasRecurrentes: data.temasRecurrentes ?? [],
        // Pre-stringify para satisfacer el tipo de Prisma (string | null).
        // La extensión cifra y al leer hace JSON.parse de vuelta.
        riesgosHistoricos: data.riesgosHistoricos
          ? JSON.stringify(data.riesgosHistoricos)
          : null,
        ultimaSesionId: data.ultimaSesionId ?? null,
        version: 1,
        aprobadoPorTerapeutaEn: ahora,
      },
    });

    // Releemos via cargarContexto para devolver la forma de GET (incluye
    // ultimasNotas y totalSesionesAprobadas — útiles para que la UI no haga
    // un segundo fetch).
    const payload = await cargarContexto(pacienteId, organizationId);
    return ok(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
