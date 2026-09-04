/**
 * Golden Thread (src/app/api/_lib/contexto-clinico/*).
 *
 * Bloque puro: formatearParaLLM, sin base.
 * Bloque de integración: cargarContexto y actualizarContexto contra la DB de
 * test. Requiere DATABASE_URL_TEST (rama Neon dedicada con las migraciones
 * aplicadas); misma convención que prisma-encryption.test.ts.
 *
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/contexto-clinico.test.ts
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { actualizarContexto } from "@/app/api/_lib/contexto-clinico/actualizar";
import { cargarContexto } from "@/app/api/_lib/contexto-clinico/cargar";
import { formatearParaLLM } from "@/app/api/_lib/contexto-clinico/formato-llm";
import {
  contextoVacio,
  type ContextoPayload,
} from "@/app/api/_lib/contexto-clinico/tipos";
import { __resetKeyCacheForTests } from "@/lib/encryption";

import {
  conectarBaseDeTest,
  hayBaseDeTest,
  vaciarTablas,
  type ClienteCifrado,
} from "./db-test";

// ─────────────────────────────────────────────────────────────────────────────
// formatearParaLLM — puro
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE: ContextoPayload = {
  pacienteId: "pac_1",
  hipotesisDiagnostica: "Trastorno de ansiedad con rasgos rumiativos.",
  resumenAcumulativo: "Sesión del 2026-03-15: cuadro de ansiedad.",
  objetivosTerapeuticos: [
    {
      id: "mejorar-higiene-sueno",
      descripcion: "Mejorar higiene del sueño",
      estado: "activo",
      fechaInicio: "2026-03-15T00:00:00.000Z",
      fechaCierre: null,
    },
    {
      id: "reducir-rumiacion",
      descripcion: "Reducir rumiación nocturna",
      estado: "cerrado",
      fechaInicio: "2026-02-01T00:00:00.000Z",
      fechaCierre: "2026-04-10T00:00:00.000Z",
    },
    {
      id: "pausado-x",
      descripcion: "Objetivo pausado (no se lista)",
      estado: "pausado",
      fechaInicio: "2026-02-01T00:00:00.000Z",
    },
  ],
  intervencionesProbadas: [
    { tecnica: "senalamiento", eficaciaPercibida: "media", sesiones: [1, 3] },
  ],
  // Desordenados a propósito: el formato ordena por conteo desc.
  temasRecurrentes: [
    { tema: "trabajo", conteo: 2 },
    { tema: "ansiedad", conteo: 5 },
  ],
  // Desordenados a propósito: el formato ordena por fecha desc.
  riesgosHistoricos: [
    {
      sesionId: "ses_03",
      fecha: "2026-03-15",
      flag: "ideacionSuicida",
      detalle: "dijo que no quería seguir",
    },
    { sesionId: "ses_05", fecha: "2026-04-10", flag: "autolesion" },
  ],
  ultimaSesionId: "ses_05",
  version: 3,
  aprobadoPorTerapeutaEn: "2026-04-11T10:00:00.000Z",
  creadoEn: "2026-03-15T09:00:00.000Z",
  actualizadoEn: "2026-04-10T12:30:00.000Z",
  ultimasNotas: [
    {
      sesionClinicaId: "ses_05",
      numero: 1,
      fechaSesion: "2026-04-10T15:00:00.000Z",
      notaAnalisis: "Menor rumiación reportada.",
      notaPlan: "Sostener registro de sueño.",
    },
    {
      sesionClinicaId: "ses_03",
      numero: 2,
      fechaSesion: "2026-03-15T15:00:00.000Z",
      notaAnalisis: null,
      notaPlan: "   ",
    },
  ],
  totalSesionesAprobadas: 5,
};

const MARKDOWN_FIXTURE = [
  "## Contexto longitudinal del paciente",
  "",
  "**Total de sesiones aprobadas previas**: 5",
  "**Última actualización del contexto**: 2026-04-10 (v3)",
  "**Revisado por la terapeuta**: 2026-04-11",
  "",
  "### Hipótesis diagnóstica de trabajo",
  "Trastorno de ansiedad con rasgos rumiativos.",
  "",
  "### Objetivos terapéuticos activos",
  "- [activo desde 2026-03-15] Mejorar higiene del sueño",
  "",
  "### Objetivos cerrados (referencia)",
  "- [cerrado 2026-04-10] Reducir rumiación nocturna",
  "",
  "### Resumen acumulativo",
  "Sesión del 2026-03-15: cuadro de ansiedad.",
  "",
  "### Temas recurrentes",
  "- ansiedad (5)",
  "- trabajo (2)",
  "",
  "### Intervenciones probadas",
  "- senalamiento: eficacia media (2 sesiones)",
  "",
  "### Riesgos históricos",
  "- 2026-04-10: autolesion",
  "- 2026-03-15: ideacionSuicida — dijo que no quería seguir",
  "",
  "### Últimas 2 sesión(es) aprobada(s) — Análisis + Plan",
  "",
  "#### Sesión del 2026-04-10",
  "",
  "**A (Análisis):**",
  "Menor rumiación reportada.",
  "",
  "**P (Plan):**",
  "Sostener registro de sueño.",
  "",
  "#### Sesión del 2026-03-15",
  "",
  "**A (Análisis):**",
  "—",
  "",
  "**P (Plan):**",
  "—",
].join("\n");

describe("formatearParaLLM", () => {
  it("fixture completo: Markdown exacto (orden, secciones, fallbacks a —)", () => {
    expect(formatearParaLLM(FIXTURE)).toBe(MARKDOWN_FIXTURE);
  });

  it("paciente sin contexto ni sesiones: solo cabecera y aviso de primer ciclo", () => {
    expect(formatearParaLLM(contextoVacio("pac_1"))).toBe(
      [
        "## Contexto longitudinal del paciente",
        "",
        "**Total de sesiones aprobadas previas**: 0",
        "",
        "_Primer ciclo del Golden Thread: no hay contexto previo ni sesiones aprobadas._",
      ].join("\n"),
    );
  });

  it("listas vacías con contexto existente: cada sección cae a —, sin cerrados ni riesgos", () => {
    const payload: ContextoPayload = {
      ...contextoVacio("pac_1"),
      version: 1,
      creadoEn: "2026-05-01T10:00:00.000Z",
      actualizadoEn: "2026-05-01T10:00:00.000Z",
      totalSesionesAprobadas: 1,
    };
    expect(formatearParaLLM(payload)).toBe(
      [
        "## Contexto longitudinal del paciente",
        "",
        "**Total de sesiones aprobadas previas**: 1",
        "**Última actualización del contexto**: 2026-05-01 (v1)",
        "**Revisado por la terapeuta**: pendiente",
        "",
        "### Hipótesis diagnóstica de trabajo",
        "—",
        "",
        "### Objetivos terapéuticos activos",
        "—",
        "",
        "### Resumen acumulativo",
        "—",
        "",
        "### Temas recurrentes",
        "—",
        "",
        "### Intervenciones probadas",
        "—",
        "",
        "### Últimas 0 sesión(es) aprobada(s) — Análisis + Plan",
        "Sin sesiones aprobadas previas.",
      ].join("\n"),
    );
  });

  it("caracteres especiales en temas se copian literalmente", () => {
    const payload: ContextoPayload = {
      ...contextoVacio("pac_1"),
      version: 2,
      actualizadoEn: "2026-05-02T00:00:00.000Z",
      temasRecurrentes: [
        { tema: "gurí", conteo: 3 },
        { tema: "**auto-exigencia** (laboral)", conteo: 2 },
        { tema: "niño/a — ¿qué?", conteo: 1 },
      ],
    };
    const salida = formatearParaLLM(payload);
    expect(salida).toContain(
      [
        "### Temas recurrentes",
        "- gurí (3)",
        "- **auto-exigencia** (laboral) (2)",
        "- niño/a — ¿qué? (1)",
      ].join("\n"),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integración — DATABASE_URL_TEST
// ─────────────────────────────────────────────────────────────────────────────

// A diferencia del resto de los archivos de integración, este tiene tests
// puros arriba: sin base de test se saltea el bloque en vez de fallar.
const describeConDb = hayBaseDeTest() ? describe : describe.skip;

describeConDb("contexto-clinico — integración", () => {
  let prismaRaw!: PrismaClient;
  let db!: ClienteCifrado;

  const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;
  const TEST_KEY_B64 = randomBytes(32).toString("base64");

  async function crearPaciente(): Promise<{
    organizationId: string;
    pacienteId: string;
  }> {
    const org = await prismaRaw.organization.create({
      data: { nombre: `Test Org ${randomUUID()}` },
    });
    const paciente = await prismaRaw.paciente.create({
      data: {
        nombre: "Test",
        apellido: "Paciente",
        telefono: "+59899000000",
        tarifa: 1000,
        organizationId: org.id,
      },
    });
    return { organizationId: org.id, pacienteId: paciente.id };
  }

  beforeAll(() => {
    process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
    __resetKeyCacheForTests();
    ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  });

  beforeEach(async () => {
    process.env.NOTES_ENCRYPTION_KEY = TEST_KEY_B64;
    __resetKeyCacheForTests();
    await vaciarTablas(prismaRaw);
  });

  afterAll(async () => {
    await prismaRaw.$disconnect();
    if (ORIGINAL_KEY === undefined) {
      delete process.env.NOTES_ENCRYPTION_KEY;
    } else {
      process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
    __resetKeyCacheForTests();
  });

  describe("cargarContexto", () => {
    it("paciente sin contexto devuelve la forma vacía del GET", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const contexto = await cargarContexto({
        prisma: db,
        pacienteId,
        organizationId,
      });
      expect(contexto).toEqual(contextoVacio(pacienteId));
    });
  });

  describe("actualizarContexto", () => {
    it("crea el contexto si no existe, con version 1", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const { version, contexto } = await actualizarContexto({
        prisma: db,
        pacienteId,
        organizationId,
        cambios: { hipotesisDiagnostica: "Hipótesis inicial." },
        actor: { tipo: "worker" },
      });
      expect(version).toBe(1);
      expect(contexto.version).toBe(1);
      expect(contexto.hipotesisDiagnostica).toBe("Hipótesis inicial.");
      expect(contexto.objetivosTerapeuticos).toEqual([]);
      expect(contexto.creadoEn).not.toBeNull();
    });

    it("incrementa version en cada PATCH y mergea solo lo enviado", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const base = { prisma: db, pacienteId, organizationId };

      await actualizarContexto({
        ...base,
        cambios: { hipotesisDiagnostica: "Uno." },
        actor: { tipo: "worker" },
      });
      const segunda = await actualizarContexto({
        ...base,
        cambios: { resumenAcumulativo: "Resumen." },
        actor: { tipo: "worker" },
      });
      const tercera = await actualizarContexto({
        ...base,
        cambios: { temasRecurrentes: [{ tema: "ansiedad", conteo: 1 }] },
        actor: { tipo: "worker" },
      });

      expect(segunda.version).toBe(2);
      expect(tercera.version).toBe(3);
      expect(tercera.contexto.hipotesisDiagnostica).toBe("Uno.");
      expect(tercera.contexto.resumenAcumulativo).toBe("Resumen.");
      expect(tercera.contexto.temasRecurrentes).toEqual([
        { tema: "ansiedad", conteo: 1 },
      ]);
    });

    it("aprobadoPorTerapeutaEn: se setea con terapeuta y vuelve a null con worker", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const base = { prisma: db, pacienteId, organizationId };

      const sugerencia = await actualizarContexto({
        ...base,
        cambios: { resumenAcumulativo: "Sugerencia de la IA." },
        actor: { tipo: "worker" },
      });
      expect(sugerencia.contexto.aprobadoPorTerapeutaEn).toBeNull();

      const revisada = await actualizarContexto({
        ...base,
        cambios: { resumenAcumulativo: "Revisado por la terapeuta." },
        actor: { tipo: "terapeuta", userId: "user_1" },
      });
      expect(revisada.contexto.aprobadoPorTerapeutaEn).not.toBeNull();

      const nuevaSugerencia = await actualizarContexto({
        ...base,
        cambios: { ultimaSesionId: "ses_9" },
        actor: { tipo: "worker" },
      });
      expect(nuevaSugerencia.contexto.aprobadoPorTerapeutaEn).toBeNull();
      expect(nuevaSugerencia.contexto.ultimaSesionId).toBe("ses_9");
    });

    it("cerrar un objetivo persiste estado y fechaCierre tal como llegan", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const base = { prisma: db, pacienteId, organizationId };

      await actualizarContexto({
        ...base,
        cambios: {
          objetivosTerapeuticos: [
            {
              id: "obj-1",
              descripcion: "Mejorar higiene del sueño",
              estado: "activo",
              fechaInicio: "2026-03-15",
              fechaCierre: null,
            },
          ],
        },
        actor: { tipo: "worker" },
      });

      const { contexto } = await actualizarContexto({
        ...base,
        cambios: {
          objetivosTerapeuticos: [
            {
              id: "obj-1",
              descripcion: "Mejorar higiene del sueño",
              estado: "cerrado",
              fechaInicio: "2026-03-15",
              fechaCierre: "2026-05-12",
            },
          ],
        },
        actor: { tipo: "terapeuta", userId: "user_1" },
      });

      expect(contexto.objetivosTerapeuticos).toEqual([
        {
          id: "obj-1",
          descripcion: "Mejorar higiene del sueño",
          estado: "cerrado",
          fechaInicio: "2026-03-15",
          fechaCierre: "2026-05-12",
        },
      ]);
    });

    it("riesgosHistoricos va y vuelve como array (columna cifrada en texto)", async () => {
      const { organizationId, pacienteId } = await crearPaciente();
      const riesgos = [
        {
          sesionId: "ses_1",
          fecha: "2026-05-01",
          flag: "autolesion",
          detalle: "cita textual",
        },
      ];
      const { contexto } = await actualizarContexto({
        prisma: db,
        pacienteId,
        organizationId,
        cambios: { riesgosHistoricos: riesgos },
        actor: { tipo: "worker" },
      });
      expect(contexto.riesgosHistoricos).toEqual(riesgos);
    });
  });
});
