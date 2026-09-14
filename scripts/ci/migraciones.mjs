// Guardián de las migraciones de Prisma. Dos verificaciones:
//
//   1. DRIFT — `schema.prisma` y `prisma/migrations` tienen que describir la
//      misma base. `prisma migrate diff --from-migrations … --to-schema-datamodel
//      … --exit-code` aplica las migraciones en una base sombra vacía y la
//      compara con el schema: si difieren, alguien editó el schema sin generar
//      la migración (o al revés) y producción va a recibir un código que
//      espera columnas que no existen. Hasta septiembre de 2026 nada lo
//      verificaba.
//
//      Los índices parciales y los CHECK escritos "A MANO" al final de
//      0_init/migration.sql no cuentan como drift: Prisma no los modela y el
//      diff los ignora (verificado contra un Postgres 17 limpio).
//
//   2. DESTRUCTIVAS — publicar.yml aplica las migraciones a producción ANTES
//      de avanzar `release`, así que el código nuevo nunca ve un esquema
//      viejo… pero el código VIEJO sí puede ver, durante unos segundos, el
//      esquema nuevo. Eso obliga a una regla:
//
//        - una migración ADITIVA (tabla, columna nullable, índice) puede ir
//          en el mismo despliegue que el código que la usa;
//        - una migración DESTRUCTIVA (DROP COLUMN/TABLE/SCHEMA/TYPE, SET NOT
//          NULL, ALTER COLUMN … TYPE, TRUNCATE, DELETE) sólo puede ir en un
//          despliegue POSTERIOR al que sacó el último código que leía eso, y
//          lo declara en su primera línea:
//
//            -- DESTRUCTIVA: el código que usaba esto salió en <sha de release>
//
//      Este guardián mira cada .sql nuevo o modificado respecto de la rama
//      base (origin/release, que es lo que está en producción; si no existe,
//      origin/main) y falla si tiene una sentencia destructiva sin la marca.
//      No verifica que el sha sea cierto —eso es criterio— pero obliga a que
//      alguien lo haya escrito, que es lo que distingue un DROP pensado de un
//      DROP pegado.
//
// Uso:
//   SHADOW_DATABASE_URL=postgresql://… node scripts/ci/migraciones.mjs
//   opciones: --base <ref>   rama contra la que se detectan los .sql nuevos
//             --sin-drift    salta la verificación 1 (local, sin base sombra)

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const sinDrift = args.includes("--sin-drift");
const baseArg = args.includes("--base") ? args[args.indexOf("--base") + 1] : null;

let fallos = 0;
const fallar = (msg) => {
  console.error(`✗ ${msg}`);
  fallos += 1;
};

// ─── 1. Drift ───────────────────────────────────────────────────────────────

if (sinDrift) {
  console.log("drift: salteado (--sin-drift)");
} else {
  const sombra = process.env.SHADOW_DATABASE_URL;
  if (!sombra) {
    fallar(
      "drift: falta SHADOW_DATABASE_URL (una base Postgres VACÍA donde aplicar las migraciones). Para saltarlo en local: --sin-drift.",
    );
  } else {
    const r = spawnSync(
      "npx",
      [
        "prisma", "migrate", "diff",
        "--from-migrations", "prisma/migrations",
        "--to-schema-datamodel", "prisma/schema.prisma",
        "--shadow-database-url", sombra,
        "--exit-code",
      ],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? sombra } },
    );
    if (r.status === 0) {
      console.log("drift: schema.prisma y prisma/migrations coinciden.");
    } else if (r.status === 2) {
      fallar(
        "drift: schema.prisma y prisma/migrations NO describen la misma base. Diferencias (lo que habría que aplicar):\n" +
          r.stdout,
      );
    } else {
      fallar(`drift: prisma migrate diff terminó con código ${r.status}.\n${r.stderr}${r.stdout}`);
    }
  }
}

// ─── 2. Destructivas sin marca ──────────────────────────────────────────────

const MARCA = /^--\s*DESTRUCTIVA:\s*el código que usaba esto salió en\s+[0-9a-f]{7,40}\s*$/i;

/** Sentencias que pierden datos o rompen lecturas del código anterior. */
const DESTRUCTIVAS = [
  /\bDROP\s+(TABLE|SCHEMA|TYPE|COLUMN)\b/i,
  /\bALTER\s+TABLE\b[^;]*\bDROP\s+(COLUMN\s+)?"?\w+"?/i,
  /\bALTER\s+TABLE\b[^;]*\bSET\s+NOT\s+NULL\b/i,
  /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8" }).trim();
}

function refExiste(ref) {
  return spawnSync("git", ["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

function ramaBase() {
  if (baseArg) return baseArg;
  if (refExiste("origin/release")) return "origin/release";
  if (refExiste("origin/main")) return "origin/main";
  return null;
}

/** El SQL sin comentarios de línea, para que la marca y los comentarios no
 *  disparen la detección. */
function sinComentarios(sql) {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const base = ramaBase();
if (!base) {
  console.log("destructivas: sin rama base (ni origin/release ni origin/main): se revisan TODAS las migraciones.");
}

let archivos;
if (base) {
  const mergeBase = git("merge-base", base, "HEAD");
  // Contra el árbol de trabajo (no contra HEAD) y más los archivos sin
  // seguimiento: así el guardián también sirve en local, antes del commit.
  const cambiados = git("diff", "--name-only", "--diff-filter=AM", mergeBase, "--", "prisma/migrations");
  const nuevos = git("ls-files", "--others", "--exclude-standard", "--", "prisma/migrations");
  archivos = [...new Set(`${cambiados}\n${nuevos}`.split("\n"))].filter((f) => f.endsWith(".sql"));
} else {
  archivos = git("ls-files", "prisma/migrations").split("\n").filter((f) => f.endsWith(".sql"));
}

let destructivasMarcadas = 0;
for (const archivo of archivos) {
  if (!existsSync(archivo)) continue;
  const sql = readFileSync(archivo, "utf8");
  const esDestructiva = DESTRUCTIVAS.some((re) => re.test(sinComentarios(sql)));
  if (!esDestructiva) continue;
  const primeraLinea = sql.split("\n").find((l) => l.trim() !== "") ?? "";
  if (MARCA.test(primeraLinea.trim())) {
    destructivasMarcadas += 1;
    continue;
  }
  fallar(
    `${archivo}: tiene una sentencia destructiva y no declara en su primera línea\n` +
      `    -- DESTRUCTIVA: el código que usaba esto salió en <sha de release>\n` +
      `  Una migración destructiva va en un despliegue POSTERIOR al que sacó el último código que leía eso.`,
  );
}

console.log(
  `destructivas: ${archivos.length} archivo(s) .sql nuevo(s) respecto de ${base ?? "(todo)"}; ` +
    `${destructivasMarcadas} destructiva(s) con marca.`,
);

if (fallos > 0) {
  console.error(`\n${fallos} problema(s) en las migraciones.`);
  process.exit(1);
}
console.log("migraciones: OK");
