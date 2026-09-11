// Verificación de una base RESTAURADA desde un backup, y el acta.
//
// Lo corre .github/workflows/ensayo-restauracion.yml contra un Postgres
// efímero recién restaurado (DATABASE_URL). Tres comprobaciones:
//
//   1. Filas por tabla. La lista de tablas sale de prisma/schema.prisma (cada
//      `@@map` de un model), así que una tabla nueva entra sola. Cada tabla
//      se compara con un PISO esperado (PISOS, abajo): hoy 0 en todas porque
//      no hay datos reales; a medida que el consultorio use la app, se suben
//      los pisos de las tablas que tienen que tener datos (una restauración
//      de una base con cero pacientes no es una restauración).
//   2. Cifrado en reposo. Toda columna *_encrypted no nula tiene que empezar
//      con "ENC1" o "ENC2" (los dos formatos que conviven durante la
//      reconstrucción). Cualquier otro prefijo es un dato en claro o
//      corrupto, y el ensayo falla. NO se descifra nada: eso lo hace el
//      dueño a mano, trimestralmente, con la clave que este workflow no tiene.
//   3. Integridad referencial. Para cada clave foránea del esquema se cuentan
//      las filas hijas cuyo padre no existe. pg_restore recrea las FK al
//      final y fallaría si hubiera violaciones, pero se verifica igual: es
//      barato y deja el número en el acta.
//
// Escribe resultado.json y sale con 1 si algo falló.
//
// Con --acta arma el texto del issue (docs/operaciones/actas/PLANTILLA-…
// rellenada) a partir de resultado.json y de los argumentos; no toca la base.
//
// Usa `psql` (PSQL, default: el del PATH) y no Prisma: así el ensayo no
// depende de `npm ci` ni del cliente generado, y corre contra cualquier base.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const PSQL = process.env.PSQL ?? "psql";

/** Piso de filas por tabla. Hoy 0: no hay datos reales. Subir a medida
 *  que haya (por ejemplo, organizaciones: 1, usuarios: 1, pacientes: 5). */
const PISOS = {
  organizaciones: 0,
  usuarios: 0,
  configuraciones: 0,
  pacientes: 0,
  turnos: 0,
  sesiones_clinicas: 0,
};

const PREFIJOS_CIFRADO = ["ENC1", "ENC2"];

// ─── Argumentos ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

if (args.includes("--acta")) {
  process.stdout.write(armarActa());
  process.exit(0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sql(consulta) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("falta DATABASE_URL");
  return execFileSync(PSQL, ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", consulta, url], {
    encoding: "utf8",
  }).trim();
}

function tablasDelSchema() {
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const tablas = [];
  let dentroDeModel = false;
  for (const linea of schema.split("\n")) {
    if (/^model\s+\w+\s*\{/.test(linea)) dentroDeModel = true;
    else if (/^enum\s+\w+\s*\{/.test(linea)) dentroDeModel = false;
    const m = linea.match(/^\s*@@map\("([^"]+)"\)/);
    if (dentroDeModel && m) tablas.push(m[1]);
    if (/^\}/.test(linea)) dentroDeModel = false;
  }
  return tablas;
}

// ─── 1. Filas por tabla ─────────────────────────────────────────────────────

function contarFilas(tablas) {
  const out = {};
  const problemas = [];
  for (const t of tablas) {
    const existe = sql(`SELECT to_regclass('public."${t}"') IS NOT NULL`) === "t";
    if (!existe) {
      out[t] = null;
      problemas.push(`la tabla ${t} no existe en la base restaurada`);
      continue;
    }
    const n = Number(sql(`SELECT count(*) FROM "${t}"`));
    out[t] = n;
    const piso = PISOS[t] ?? 0;
    if (n < piso) problemas.push(`${t}: ${n} filas, el piso es ${piso}`);
  }
  return { conteos: out, problemas };
}

// ─── 2. Cifrado en reposo ───────────────────────────────────────────────────

function verificarCifrado() {
  const columnas = sql(
    `SELECT table_name || '.' || column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name LIKE '%\\_encrypted' AND data_type = 'bytea'
     ORDER BY 1`,
  )
    .split("\n")
    .filter(Boolean);

  const porPrefijo = Object.fromEntries(PREFIJOS_CIFRADO.map((p) => [p, 0]));
  let otros = 0;
  const problemas = [];
  const detalle = {};

  for (const col of columnas) {
    const [tabla, columna] = col.split(".");
    const fila = sql(
      `SELECT
         count(*) FILTER (WHERE substring("${columna}" from 1 for 4) = '\\x454e4331'::bytea),
         count(*) FILTER (WHERE substring("${columna}" from 1 for 4) = '\\x454e4332'::bytea),
         count(*) FILTER (WHERE "${columna}" IS NOT NULL
           AND substring("${columna}" from 1 for 4) NOT IN ('\\x454e4331'::bytea, '\\x454e4332'::bytea))
       FROM "${tabla}"`,
    ).split("|");
    const [enc1, enc2, malos] = fila.map(Number);
    porPrefijo.ENC1 += enc1;
    porPrefijo.ENC2 += enc2;
    otros += malos;
    detalle[col] = { ENC1: enc1, ENC2: enc2, otros: malos };
    if (malos > 0) problemas.push(`${col}: ${malos} valor(es) que no empiezan con ENC1/ENC2`);
  }

  return { columnas: columnas.length, porPrefijo, otros, detalle, problemas };
}

// ─── 3. Claves foráneas ─────────────────────────────────────────────────────

function verificarClavesForaneas() {
  const crudo = sql(
    `SELECT json_agg(json_build_object(
        'nombre', c.conname,
        'hija', c.conrelid::regclass::text,
        'padre', c.confrelid::regclass::text,
        'columnasHija', (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
        'columnasPadre', (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
     ))
     FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const fks = crudo && crudo !== "" ? JSON.parse(crudo) ?? [] : [];

  const problemas = [];
  let violaciones = 0;
  for (const fk of fks) {
    const noNulas = fk.columnasHija.map((c) => `h."${c}" IS NOT NULL`).join(" AND ");
    const join = fk.columnasHija.map((c, i) => `p."${fk.columnasPadre[i]}" = h."${c}"`).join(" AND ");
    const n = Number(
      sql(
        `SELECT count(*) FROM ${fk.hija} h WHERE ${noNulas}
         AND NOT EXISTS (SELECT 1 FROM ${fk.padre} p WHERE ${join})`,
      ),
    );
    if (n > 0) {
      violaciones += n;
      problemas.push(`${fk.nombre}: ${n} fila(s) de ${fk.hija} sin padre en ${fk.padre}`);
    }
  }
  return { constraints: fks.length, violaciones, problemas };
}

// ─── Acta ───────────────────────────────────────────────────────────────────

function armarActa() {
  const resultado = existsSync(join(RAIZ, "resultado.json"))
    ? JSON.parse(readFileSync(join(RAIZ, "resultado.json"), "utf8"))
    : null;
  const estado = flag("--resultado") ?? "desconocido";
  const lineas = [
    "## Acta de ensayo de restauración (automático, mensual)",
    "",
    `- **Fecha:** ${new Date().toISOString().slice(0, 10)}`,
    "- **Ejecutó:** GitHub Actions (ensayo-restauracion.yml)",
    `- **Archivo:** \`${flag("--archivo") ?? "?"}\` (fecha del backup: ${flag("--fecha-backup") ?? "?"})`,
    "- **Destino:** Postgres 17 efímero en el runner",
    `- **Duración de pg_restore:** ${flag("--duracion") ?? "?"} s`,
    `- **Resultado:** ${estado}`,
    `- **Corrida:** ${flag("--corrida") ?? "?"}`,
    "",
    "### Conteo de filas por tabla",
    "",
  ];
  if (resultado) {
    lineas.push("| Tabla | Filas |", "| --- | --- |");
    for (const [t, n] of Object.entries(resultado.tablas.conteos)) lineas.push(`| ${t} | ${n ?? "no existe"} |`);
    lineas.push(
      "",
      `### Cifrado: ${resultado.cifrado.columnas} columnas \`*_encrypted\`; ENC1: ${resultado.cifrado.porPrefijo.ENC1}, ENC2: ${resultado.cifrado.porPrefijo.ENC2}, otros: ${resultado.cifrado.otros} → **${resultado.cifrado.otros === 0 ? "sí" : "NO"}**`,
      `### Claves foráneas: ${resultado.fk.constraints} verificadas, ${resultado.fk.violaciones} violaciones`,
      "",
    );
    if (resultado.problemas.length > 0) {
      lineas.push("### Problemas encontrados", "", ...resultado.problemas.map((p) => `- ${p}`), "");
    } else {
      lineas.push("### Problemas encontrados", "", "Ninguno.", "");
    }
  } else {
    lineas.push("_No hay resultado.json: el ensayo falló antes de verificar._", "");
  }
  lineas.push(
    "### Nota clínica descifrada y leída",
    "",
    "**No aplica al ensayo automático.** Este workflow no tiene la clave del cifrado clínico a propósito. " +
      "La prueba de que la clave todavía abre una nota es el ensayo A MANO trimestral del dueño " +
      "(docs/operaciones.md §4), con acta en docs/operaciones/actas/.",
    "",
    "### Próximo ensayo automático: el día 1 del mes que viene.",
  );
  return lineas.join("\n") + "\n";
}

// ─── Main ───────────────────────────────────────────────────────────────────

const tablas = tablasDelSchema();
if (tablas.length === 0) {
  console.error("No se encontró ninguna tabla en prisma/schema.prisma.");
  process.exit(1);
}

const filas = contarFilas(tablas);
const cifrado = verificarCifrado();
const fk = verificarClavesForaneas();
const problemas = [...filas.problemas, ...cifrado.problemas, ...fk.problemas];

const resultado = {
  fecha: new Date().toISOString(),
  archivo: process.env.BACKUP_ARCHIVO ?? null,
  tablas: filas,
  cifrado,
  fk,
  problemas,
  ok: problemas.length === 0,
};
writeFileSync(join(RAIZ, "resultado.json"), JSON.stringify(resultado, null, 2));

console.log(`tablas: ${tablas.length}; columnas cifradas: ${cifrado.columnas} (ENC1 ${cifrado.porPrefijo.ENC1}, ENC2 ${cifrado.porPrefijo.ENC2}, otros ${cifrado.otros}); FK: ${fk.constraints}, violaciones ${fk.violaciones}`);
for (const [t, n] of Object.entries(filas.conteos)) console.log(`  ${t}: ${n ?? "NO EXISTE"}`);

if (problemas.length > 0) {
  console.error("\nProblemas:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nrestauración verificada: OK");
