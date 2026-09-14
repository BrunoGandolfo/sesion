/**
 * Guardián: ninguna ruta de la API habla con Prisma directo.
 *
 * Regla (AGENTS.md): un `route.ts` bajo src/app/api/** solo lee la sesión,
 * valida el body con Zod, llama a una función de `_lib/casos-uso/*` y
 * responde con `_lib/responses.ts`. Toda regla de negocio, incluida una sola
 * consulta de lectura, vive en un caso de uso. Pasar `db` como parámetro
 * (`prisma: db`) está bien; `db.turno.findMany(...)` en la ruta, no.
 *
 * Mismo patrón que middleware-edge.test.ts: la lista de rutas sale del
 * disco (fs), no de una lista escrita a mano, así una ruta nueva entra sola.
 *
 * EXCEPCIONES TEMPORALES. Las rutas de sesión clínica, recordatorios/SMS,
 * cuenta y seed son de otras áreas de la reconstrucción y todavía consultan
 * Prisma desde la ruta. Están listadas abajo con su dueño para que el
 * guardián no bloquee sus ramas; la lista tiene que quedar VACÍA cuando
 * terminen de migrar. Para que no se olvide, el test también falla si una
 * excepción ya está limpia y sigue en la lista.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ_API = join(process.cwd(), "src", "app", "api");

/** Rutas de otras áreas que aún no migraron a casos de uso. Ruta relativa a
 *  src/app/api, con el área dueña. Quitar cada una al migrarla. */
const EXCEPCIONES_TEMPORALES: Record<string, string> = {
  "cuenta/password/route.ts": "área 3 (identidad)",
  // `SELECT 1` para saber si la base contesta: mover a casos-uso/salud.ts.
  "health/route.ts": "área 5 (operación)",
  "pacientes/[id]/brief/route.ts": "área 4 (recorrido)",
  "pacientes/[id]/consentimiento/route.ts": "área 3 (identidad)",
  "pacientes/[id]/contexto-clinico/route.ts": "área 4 (recorrido)",
  "pacientes/[id]/documentacion/route.ts": "área 1/2 (sesión clínica)",
  "pacientes/[id]/progreso/route.ts": "área 4 (recorrido)",
  // Las rutas del SMS durable y del latido del worker nacieron después de
  // la regla; el área 5 las mueve a casos de uso cuando pase por acá.
  "cron/recordatorios/route.ts": "área 5 (SMS)",
  "estado-worker/route.ts": "área 5 (operación)",
  "sms/callback/route.ts": "área 5 (SMS)",
  "sms/entrante/route.ts": "área 5 (SMS)",
  "sesion-clinica/[id]/upload-confirmar/route.ts": "área 1 (grabador)",
  "sesion-clinica/[id]/upload-url/route.ts": "área 1 (grabador)",
  "sesion-clinica/route.ts": "área 2 (estados)",
};

/**
 * `db.<modelo>.<operación>(` o `db.$transaction(` / `db.$queryRaw` /
 * `db.$executeRaw`, con `db` o `prisma` como nombre del cliente. `db,` o
 * `prisma: db` (pasarlo a un caso de uso) no matchea: hace falta el punto.
 */
const LLAMADA_PRISMA =
  /\b(?:db|prisma)\s*\.\s*(?:\$transaction|\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|[a-zA-Z]+\s*\.\s*(?:findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy))\b/;

function rutas(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      salida.push(...rutas(ruta));
    } else if (nombre === "route.ts") {
      salida.push(ruta);
    }
  }
  return salida.sort();
}

/** Líneas con una llamada a Prisma, sin contar comentarios. */
function llamadasEn(archivo: string): string[] {
  return readFileSync(archivo, "utf8")
    .split("\n")
    .map((linea, i) => ({ linea, numero: i + 1 }))
    .filter(({ linea }) => !linea.trim().startsWith("//") && !linea.trim().startsWith("*"))
    .filter(({ linea }) => LLAMADA_PRISMA.test(linea))
    .map(({ linea, numero }) => `${numero}: ${linea.trim()}`);
}

describe("ninguna route.ts llama a Prisma directo", () => {
  const todas = rutas(RAIZ_API).map((abs) => ({
    abs,
    rel: relative(RAIZ_API, abs).split("\\").join("/"),
  }));

  it("encuentra las rutas en el disco", () => {
    expect(todas.length).toBeGreaterThan(20);
  });

  const vigiladas = todas.filter(({ rel }) => !(rel in EXCEPCIONES_TEMPORALES));
  const exceptuadas = todas.filter(({ rel }) => rel in EXCEPCIONES_TEMPORALES);

  it.each(vigiladas.map(({ abs, rel }) => [rel, abs]))(
    "%s",
    (_rel, abs) => {
      expect(llamadasEn(abs)).toEqual([]);
    },
  );

  it("las rutas de pacientes, turnos, config, dashboard y hot-words están vigiladas", () => {
    const propias = todas
      .map(({ rel }) => rel)
      .filter((rel) =>
        /^(pacientes\/(\[id\]\/)?route\.ts|turnos\/|config\/|dashboard\/|hot-words\/)/.test(rel),
      );
    expect(propias.length).toBeGreaterThanOrEqual(9);
    for (const rel of propias) {
      expect(rel in EXCEPCIONES_TEMPORALES, `${rel} no puede estar exceptuada`).toBe(false);
    }
  });

  it("toda excepción sigue existiendo y sigue sucia (si ya migró, sacarla de la lista)", () => {
    const existentes = new Set(todas.map(({ rel }) => rel));
    for (const rel of Object.keys(EXCEPCIONES_TEMPORALES)) {
      expect(existentes.has(rel), `${rel} ya no existe: sacarla de EXCEPCIONES_TEMPORALES`).toBe(true);
    }
    for (const { abs, rel } of exceptuadas) {
      expect(
        llamadasEn(abs).length,
        `${rel} ya no llama a Prisma: sacarla de EXCEPCIONES_TEMPORALES`,
      ).toBeGreaterThan(0);
    }
  });
});
