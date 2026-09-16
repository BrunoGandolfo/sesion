// Verificación de una base RESTAURADA desde un respaldo, y el acta.
//
// Lo corre .github/workflows/ensayo-restauracion.yml contra un Postgres
// efímero recién restaurado por scripts/ensayo/restaurar.sh (DATABASE_URL),
// una vez por copia (diaria y mensual). Cuatro comprobaciones:
//
//   1. Filas por tabla. La lista de tablas sale de prisma/schema.prisma (cada
//      `@@map` de un model). Las tablas de MINIMOS tienen que tener al menos
//      esa cantidad de filas: una base restaurada sin pacientes ni sesiones
//      no es una restauración, es una base vacía con el esquema puesto.
//   2. Cifrado en reposo. Toda columna *_encrypted no nula tiene que ser un
//      blob ENC2, y el id de clave de cada blob (byte 4) tiene que estar en
//      el llavero del ensayo. Un id ausente es LA señal de "esta copia es de
//      una época cuya clave se retiró": se informa como clave ausente, no
//      como corrupción, y se dice qué clave hay que agregar.
//   3. Descifrado. Se descifran de verdad, con AES-256-GCM y el AAD de su
//      celda, la nota clínica más vieja y la más nueva (nota_final o, si no
//      hay ninguna aprobada, nota_ia) y la versión del Recorrido más vieja y
//      la más nueva, y se comprueba que lo descifrado es el JSON esperado.
//      Nada del texto se imprime ni se guarda: solo ids y sí/no.
//   4. Integridad referencial. Para cada clave foránea se cuentan las filas
//      hijas sin padre. pg_restore ya fallaría, pero deja el número en el acta.
//
// Escribe resultado-<etiqueta>.json en --salida (default: cwd) y sale con 1
// si algo falló.
//
// Con --acta arma el texto del issue a partir de los resultado-*.json y de
// los argumentos; no toca la base.
//
// Llavero: CLAVES_CIFRADO con el mismo formato que la app ("1=<base64>,2=…").
// En el workflow sale del secret CLAVES_CIFRADO_ENSAYO, que tiene que tener
// TODAS las claves con que alguna vez se cifró, también las que la app ya
// retiró: una copia mensual de hace once meses puede necesitarlas.
//
// Usa `psql` (PSQL, o PG_BIN/psql, o el del PATH) y no Prisma: así el ensayo
// no depende de `npm ci` ni del cliente generado, y corre contra cualquier base.

import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PSQL = process.env.PSQL ?? (process.env.PG_BIN ? join(process.env.PG_BIN, "psql") : "psql");
const VARIABLE_LLAVERO = "CLAVES_CIFRADO";
const SECRET_LLAVERO = "CLAVES_CIFRADO_ENSAYO";

/** Filas mínimas por tabla. Una copia con menos no sirve para volver a
 *  atender: no hay a quién ni qué. */
const MINIMOS = {
  organizaciones: 1,
  usuarios: 1,
  pacientes: 1,
  turnos: 1,
  sesiones_clinicas: 1,
  hilos: 1,
  hilo_versiones: 1,
};

/** Qué se descifra: la muestra más vieja y la más nueva de cada una. */
const MUESTRAS = [
  {
    rotulo: "nota clínica",
    tabla: "sesiones_clinicas",
    // En orden de preferencia: la aprobada; si no hay ninguna, la de la IA.
    columnas: ["nota_final_encrypted", "nota_ia_encrypted"],
    valida: (v) => v !== null && typeof v === "object" && ["subjetivo", "objetivo", "analisis", "plan"].every((k) => k in v),
  },
  {
    rotulo: "versión del Recorrido",
    tabla: "hilo_versiones",
    columnas: ["contenido_encrypted"],
    valida: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  },
];

// ENC2: "ENC2" | id de clave (1) | IV (12) | tag (16) | ciphertext. AAD
// "<tabla>:<columna>:<id>". Copia de src/lib/encryption.ts, que este script
// no puede importar (TypeScript, y el ensayo corre sin `npm ci`); el test
// cifra con el módulo real y exige que esto lo descifre.
const MAGIC = Buffer.from("ENC2", "ascii");
const POS_ID = 4, POS_IV = 5, POS_TAG = 17, POS_CT = 33;

// ─── Argumentos ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const SALIDA = resolve(flag("--salida") ?? process.cwd());
const ETIQUETA = flag("--etiqueta") ?? "copia";

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
    stdio: ["ignore", "pipe", "inherit"],
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

/** Mismas reglas que src/lib/llavero.ts. Devuelve Map<id, Buffer>. */
function parsearLlavero(texto) {
  if (typeof texto !== "string" || texto.trim() === "") {
    throw new Error(
      `falta ${VARIABLE_LLAVERO} (en el workflow, el secret ${SECRET_LLAVERO}): sin llavero el ensayo no puede demostrar que el contenido clínico se lee.`,
    );
  }
  const claves = new Map();
  for (const cruda of texto.split(",")) {
    const entrada = cruda.trim();
    if (entrada === "") continue;
    const sep = entrada.indexOf("=");
    if (sep <= 0) throw new Error(`${VARIABLE_LLAVERO}: entrada sin "id=clave"`);
    const idTexto = entrada.slice(0, sep).trim();
    if (!/^\d+$/.test(idTexto) || Number(idTexto) < 1 || Number(idTexto) > 255) {
      throw new Error(`${VARIABLE_LLAVERO}: id "${idTexto}" fuera de rango (1..255)`);
    }
    const id = Number(idTexto);
    const clave = Buffer.from(entrada.slice(sep + 1).trim(), "base64");
    if (clave.length !== 32) throw new Error(`${VARIABLE_LLAVERO}: la clave ${id} no decodifica a 32 bytes`);
    if (claves.has(id)) throw new Error(`${VARIABLE_LLAVERO}: id ${id} repetido`);
    claves.set(id, clave);
  }
  if (claves.size === 0) throw new Error(`${VARIABLE_LLAVERO}: no tiene ninguna clave`);
  return claves;
}

class ErrorDescifrado extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const mensajeClaveAusente = (id) =>
  `falta la clave ${id} en el llavero del ensayo: el dato es de una época cuya clave ya no está. ` +
  `No es corrupción: agregar la clave ${id} a ${SECRET_LLAVERO} y repetir el ensayo.`;

function descifrar(blob, aad, llavero) {
  if (blob.length < POS_CT || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new ErrorDescifrado("formato", "no tiene el prefijo ENC2 o es demasiado corto: dato corrupto o sin cifrar");
  }
  const id = blob[POS_ID];
  const clave = llavero.get(id);
  if (!clave) throw new ErrorDescifrado("clave_ausente", mensajeClaveAusente(id));
  const decipher = createDecipheriv("aes-256-gcm", clave, blob.subarray(POS_IV, POS_TAG), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(blob.subarray(POS_TAG, POS_CT));
  try {
    return Buffer.concat([decipher.update(blob.subarray(POS_CT)), decipher.final()]).toString("utf8");
  } catch {
    throw new ErrorDescifrado(
      "autenticacion",
      `no descifra con la clave ${id}: dato corrupto o alterado (o la clave ${id} del llavero no es la de esa época)`,
    );
  }
}

// ─── 1. Filas por tabla ─────────────────────────────────────────────────────

function contarFilas(tablas) {
  const conteos = {};
  const problemas = [];
  for (const t of tablas) {
    const existe = sql(`SELECT to_regclass('public."${t}"') IS NOT NULL`) === "t";
    if (!existe) {
      conteos[t] = null;
      problemas.push(`la tabla ${t} no existe en la base restaurada`);
      continue;
    }
    const n = Number(sql(`SELECT count(*) FROM "${t}"`));
    conteos[t] = n;
    const minimo = MINIMOS[t] ?? 0;
    if (n === 0 && minimo > 0) problemas.push(`tabla ${t} vacía: 0 filas, el mínimo es ${minimo}`);
    else if (n < minimo) problemas.push(`${t}: ${n} filas, el mínimo es ${minimo}`);
  }
  return { conteos, problemas };
}

// ─── 2. Cifrado en reposo: prefijo e ids de clave ───────────────────────────

function verificarCifrado(llavero) {
  const columnas = sql(
    `SELECT table_name || '.' || column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name LIKE '%\\_encrypted' AND data_type = 'bytea'
     ORDER BY 1`,
  )
    .split("\n")
    .filter(Boolean);

  const porClave = {};
  let otros = 0;
  const detalle = {};
  const problemas = [];
  const clavesAusentes = new Set();

  for (const col of columnas) {
    const [tabla, columna] = col.split(".");
    const [ids, malos] = sql(
      `SELECT coalesce(json_object_agg(id, n) FILTER (WHERE id IS NOT NULL), '{}'),
              coalesce(sum(n) FILTER (WHERE id IS NULL), 0)
       FROM (SELECT CASE WHEN length("${columna}") >= ${POS_CT}
                          AND substring("${columna}" from 1 for 4) = '\\x454e4332'::bytea
                         THEN get_byte("${columna}", ${POS_ID}) END AS id, count(*) AS n
             FROM "${tabla}" WHERE "${columna}" IS NOT NULL GROUP BY 1) s`,
    ).split("|");
    const porClaveCol = Object.fromEntries(Object.entries(JSON.parse(ids)).map(([k, v]) => [Number(k), Number(v)]));
    detalle[col] = { porClave: porClaveCol, otros: Number(malos) };
    otros += Number(malos);
    if (Number(malos) > 0) problemas.push(`${col}: ${malos} valor(es) sin prefijo ENC2: dato corrupto o sin cifrar`);
    for (const [id, n] of Object.entries(porClaveCol)) {
      porClave[id] = (porClave[id] ?? 0) + n;
      if (!llavero.has(Number(id))) {
        clavesAusentes.add(Number(id));
        problemas.push(`${col}: ${n} valor(es) cifrados con la clave ${id}; ${mensajeClaveAusente(id)}`);
      }
    }
  }

  return { columnas: columnas.length, porClave, otros, clavesAusentes: [...clavesAusentes].sort(), detalle, problemas };
}

// ─── 3. Descifrado de muestras ──────────────────────────────────────────────

function descifrarMuestras(llavero) {
  const muestras = [];
  const problemas = [];

  for (const def of MUESTRAS) {
    const columna = def.columnas.find(
      (c) => Number(sql(`SELECT count(*) FROM "${def.tabla}" WHERE "${c}" IS NOT NULL`)) > 0,
    );
    if (!columna) {
      problemas.push(`no hay ninguna ${def.rotulo} en la copia (${def.tabla}.${def.columnas.join("/")} todas NULL): nada que descifrar`);
      continue;
    }
    for (const orden of ["ASC", "DESC"]) {
      const [id, hex] = sql(
        `SELECT id, encode("${columna}", 'hex') FROM "${def.tabla}"
         WHERE "${columna}" IS NOT NULL ORDER BY creada_en ${orden}, id ${orden} LIMIT 1`,
      ).split("|");
      const blob = Buffer.from(hex, "hex");
      const muestra = {
        rotulo: def.rotulo,
        tabla: def.tabla,
        columna,
        id,
        cual: orden === "ASC" ? "más vieja" : "más nueva",
        claveId: blob.length > POS_ID && blob.subarray(0, 4).equals(MAGIC) ? blob[POS_ID] : null,
        ok: false,
      };
      try {
        const texto = descifrar(blob, `${def.tabla}:${columna}:${id}`, llavero);
        let valor;
        try {
          valor = JSON.parse(texto);
        } catch {
          throw new ErrorDescifrado("contenido", "descifra, pero el texto no es JSON");
        }
        if (!def.valida(valor)) throw new ErrorDescifrado("contenido", "descifra, pero el JSON no tiene la forma esperada");
        muestra.ok = true;
      } catch (error) {
        if (!(error instanceof ErrorDescifrado)) throw error;
        muestra.codigo = error.codigo;
        muestra.error = error.message;
        problemas.push(`${def.rotulo} ${muestra.cual} (${def.tabla}.${columna} ${id}): ${error.message}`);
      }
      muestras.push(muestra);
    }
  }
  return { llavero: [...llavero.keys()].sort((a, b) => a - b), muestras, problemas };
}

// ─── 4. Claves foráneas ─────────────────────────────────────────────────────

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
  const fks = crudo ? JSON.parse(crudo) ?? [] : [];

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

function seccionCopia(etiqueta, archivo) {
  const ruta = join(SALIDA, `resultado-${etiqueta}.json`);
  const r = existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null;
  const titulo = { diario: "Copia diaria (la más reciente)", mensual: "Copia mensual (la más vieja)" }[etiqueta] ?? `Copia ${etiqueta}`;
  const lineas = [`### ${titulo}: \`${archivo ?? r?.archivo ?? "?"}\``, ""];
  if (!r) {
    lineas.push("_No hay resultado: el ensayo de esta copia falló antes de verificar (descifrado gpg, índice o pg_restore; ver la corrida)._", "");
    return lineas;
  }
  lineas.push(`- **Fecha del respaldo:** ${r.fechaArchivo ?? "?"}`, `- **Resultado de la verificación:** ${r.ok ? "OK" : "FALLÓ"}`, "", "| Tabla | Filas |", "| --- | --- |");
  for (const [t, n] of Object.entries(r.tablas.conteos)) lineas.push(`| ${t} | ${n ?? "no existe"} |`);
  const claves = Object.entries(r.cifrado.porClave).map(([id, n]) => `clave ${id}: ${n}`).join(", ") || "ninguna";
  lineas.push(
    "",
    `- **Cifrado:** ${r.cifrado.columnas} columnas \`*_encrypted\`; blobs por clave: ${claves}; sin prefijo ENC2: ${r.cifrado.otros}` +
      (r.cifrado.clavesAusentes.length ? `; **claves que faltan en el llavero: ${r.cifrado.clavesAusentes.join(", ")}**` : ""),
    `- **Llavero del ensayo:** ids ${r.descifrado.llavero.join(", ")} (nunca los valores)`,
  );
  for (const m of r.descifrado.muestras) {
    lineas.push(
      `- **${m.rotulo[0].toUpperCase()}${m.rotulo.slice(1)} ${m.cual} descifrada y leída:** ${m.ok ? "sí" : "NO"} (${m.tabla} \`${m.id}\`, clave ${m.claveId ?? "?"}${m.ok ? "" : `; ${m.codigo}: ${m.error}`})`,
    );
  }
  lineas.push(`- **Claves foráneas:** ${r.fk.constraints} verificadas, ${r.fk.violaciones} violaciones`, "");
  lineas.push("**Problemas:**", "", ...(r.problemas.length ? r.problemas.map((p) => `- ${p}`) : ["Ninguno."]), "");
  return lineas;
}

function armarActa() {
  return [
    "## Acta de ensayo de restauración (automático, mensual)",
    "",
    `- **Fecha:** ${new Date().toISOString().slice(0, 10)}`,
    "- **Ejecutó:** GitHub Actions (ensayo-restauracion.yml)",
    "- **Destino:** Postgres 17 efímero en el runner, una base por copia",
    `- **Resultado de la corrida:** ${flag("--resultado") ?? "desconocido"}`,
    `- **Corrida:** ${flag("--corrida") ?? "?"}`,
    "",
    ...seccionCopia("diario", flag("--diario")),
    ...seccionCopia("mensual", flag("--mensual")),
    "Este ensayo descifra una nota clínica y una versión del Recorrido con el llavero del secret " +
      `${SECRET_LLAVERO}. El ensayo A MANO trimestral (docs/operaciones.md §4) sigue siendo obligatorio y deja su acta en docs/operaciones/actas/.`,
    "",
    "### Próximo ensayo automático: el día 1 del mes que viene.",
    "",
  ].join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

let llavero;
try {
  llavero = parsearLlavero(process.env[VARIABLE_LLAVERO]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const tablas = tablasDelSchema();
if (tablas.length === 0) {
  console.error("No se encontró ninguna tabla en prisma/schema.prisma.");
  process.exit(1);
}

const filas = contarFilas(tablas);
const cifrado = verificarCifrado(llavero);
const descifrado = descifrarMuestras(llavero);
const fk = verificarClavesForaneas();
const problemas = [...filas.problemas, ...cifrado.problemas, ...descifrado.problemas, ...fk.problemas];

const resultado = {
  fecha: new Date().toISOString(),
  etiqueta: ETIQUETA,
  archivo: process.env.BACKUP_ARCHIVO ?? null,
  fechaArchivo: process.env.BACKUP_FECHA ?? null,
  tablas: filas,
  cifrado,
  descifrado,
  fk,
  problemas,
  ok: problemas.length === 0,
};
writeFileSync(join(SALIDA, `resultado-${ETIQUETA}.json`), JSON.stringify(resultado, null, 2));

console.log(
  `[${ETIQUETA}] tablas: ${tablas.length}; columnas cifradas: ${cifrado.columnas} (por clave ${JSON.stringify(cifrado.porClave)}, sin ENC2 ${cifrado.otros}); ` +
    `muestras descifradas: ${descifrado.muestras.filter((m) => m.ok).length}/${descifrado.muestras.length}; FK: ${fk.constraints}, violaciones ${fk.violaciones}`,
);
for (const [t, n] of Object.entries(filas.conteos)) console.log(`  ${t}: ${n ?? "NO EXISTE"}`);
for (const m of descifrado.muestras) console.log(`  ${m.rotulo} ${m.cual} (${m.tabla} ${m.id}, clave ${m.claveId ?? "?"}): ${m.ok ? "descifrada y leída" : m.codigo}`);

if (problemas.length > 0) {
  console.error("\nProblemas:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nrestauración verificada: OK");
