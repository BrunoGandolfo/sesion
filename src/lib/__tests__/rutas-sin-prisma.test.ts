/**
 * Guardián: ninguna ruta de la API habla con Prisma directo.
 *
 * Regla (AGENTS.md): un `route.ts` bajo src/app/api/** solo lee la sesión,
 * valida el body con Zod, llama a una función de `_lib/casos-uso/*` y
 * responde con `_lib/responses.ts`. Toda regla de negocio, incluida una sola
 * consulta de lectura, vive en un caso de uso. Pasar `db` como parámetro
 * (`prisma: db`) está bien; `db.turno.findMany(...)` en la ruta, no.
 *
 * Mismo patrón que proxy-liviano.test.ts: la lista de rutas sale del
 * disco (fs), no de una lista escrita a mano, así una ruta nueva entra sola.
 *
 * Sin excepciones: las rutas de sesión clínica, SMS, cuenta y documentación
 * migraron todas a casos de uso. Una ruta nueva que consulte Prisma no entra.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ_API = join(process.cwd(), "src", "app", "api");

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

  it.each(todas.map(({ abs, rel }) => [rel, abs]))(
    "%s",
    (_rel, abs) => {
      expect(llamadasEn(abs)).toEqual([]);
    },
  );
});
