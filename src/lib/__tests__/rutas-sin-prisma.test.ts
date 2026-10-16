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

import { Prisma } from "@prisma/client";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ_API = join(process.cwd(), "src", "app", "api");

/** Los delegados del cliente: `turno`, `sesionClinica`… salen del esquema. */
const MODELOS = Object.values(Prisma.ModelName).map((m) => m[0].toLowerCase() + m.slice(1));

/**
 * `<cliente>.<modelo>.<operación>` o `<cliente>.$transaction` / `$queryRaw` /
 * `$executeRaw…`, con CUALQUIER nombre de cliente (`db`, `prisma`, `tx`…) y
 * aunque la llamada esté partida en varias líneas. `db,` o `prisma: db`
 * (pasarlo a un caso de uso) no matchea: hace falta el punto. Un puerto que
 * la ruta arma con `db` y pasa al caso de uso (`repositorioRegistro(db)`)
 * tampoco: no hay modelo detrás del punto.
 */
const LLAMADA_PRISMA = new RegExp(
  String.raw`\b[A-Za-z_$][\w$]*\s*(?:\?\.|\.)\s*(?:\$transaction|\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|(?:${MODELOS.join("|")})\s*\.\s*(?:findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy))\b`,
  "g",
);

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

/** Las llamadas a Prisma de un fuente, sin comentarios y con los espacios
 *  (saltos de línea incluidos) colapsados. */
function llamadasEnFuente(fuente: string): string[] {
  const sinComentarios = ts
    .createPrinter({ removeComments: true })
    .printFile(ts.createSourceFile("route.ts", fuente, ts.ScriptTarget.Latest, true));
  return [...sinComentarios.matchAll(LLAMADA_PRISMA)].map((m) => m[0].replace(/\s+/g, ""));
}

describe("el detector, sobre fuentes de mentira", () => {
  it("ve cualquier nombre de cliente, la llamada partida y el $transaction; no ve pasar el cliente", () => {
    expect(llamadasEnFuente("await tx.turno.findMany({});")).toEqual(["tx.turno.findMany"]);
    expect(llamadasEnFuente("await cliente\n  .sesionClinica\n  .update({});")).toEqual(["cliente.sesionClinica.update"]);
    expect(llamadasEnFuente("await base.$transaction(async () => {});")).toEqual(["base.$transaction"]);
    expect(llamadasEnFuente("await db.paciente.count();")).toEqual(["db.paciente.count"]);
    expect(llamadasEnFuente("// db.turno.findMany()\n/* prisma.turno.update() */\ncaso({ prisma: db });")).toEqual([]);
    expect(llamadasEnFuente("repositorioRegistro(db); parsed.data.update; x.turnos.map(f);")).toEqual([]);
  });
});

describe("ninguna route.ts llama a Prisma directo", () => {
  const todas = rutas(RAIZ_API).map((abs) => ({
    abs,
    rel: relative(RAIZ_API, abs).split("\\").join("/"),
  }));

  it("encuentra las rutas en el disco y los modelos en el esquema", () => {
    expect(todas.length).toBeGreaterThan(20);
    expect(MODELOS).toEqual(expect.arrayContaining(["turno", "sesionClinica", "eventoAuditoria"]));
  });

  it.each(todas.map(({ abs, rel }) => [rel, abs]))(
    "%s",
    (_rel, abs) => {
      expect(llamadasEnFuente(readFileSync(abs, "utf8"))).toEqual([]);
    },
  );
});
