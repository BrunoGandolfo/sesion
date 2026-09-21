// Verificación de una base RESTAURADA desde un respaldo, y el acta.
//
// Lo corre .github/workflows/ensayo-restauracion.yml contra un Postgres
// efímero recién restaurado por scripts/ensayo/restaurar.sh (DATABASE_URL),
// una vez por copia (diaria y mensual), y scripts/ensayo/ensayo-manual.sh en
// la máquina del dueño. Comprobaciones:
//
//   0. Esquema conocido. Compara tablas, columnas y tipos con producción
//      d02ae0e (instantánea conservada acá) y con prisma/schema.prisma. Si
//      no coincide con ninguno, informa esquema desconocido y falla.
//   1. Filas por tabla. Usa las tablas y mínimos del esquema detectado:
//      una base sin pacientes ni sesiones está vacía, aunque se restauró.
//   2. Cifrado en reposo. Toda columna *_encrypted no nula tiene que ser un
//      blob ENC1 (producción) o ENC2 (nuevo). En ENC2 el id (byte 4) debe
//      estar entre los ids conocidos: si no está, se informa clave ausente,
//      no corrupción. ENC1 no guarda id; el automático solo puede comprobar
//      su formato y deja explícito que no identificó ni probó la clave.
//   3. Muestras: nota clínica más vieja y más nueva; contexto actual por
//      paciente en producción, versiones del Recorrido en el nuevo. Usa
//      las columnas y fechas propias de cada esquema. Sin muestras falla.
//      - Ensayo AUTOMÁTICO (CLAVES_CIFRADO_IDS): no se descifra nada. La
//        clave clínica no vive en GitHub Actions, a propósito.
//      - Ensayo MANUAL (CLAVES_CIFRADO, en la máquina del dueño): se
//        descifra con AES-256-GCM. ENC2 usa id y AAD; ENC1 prueba las claves
//        del llavero sin AAD, como producción. Se valida JSON o texto según
//        la columna. Nada del contenido se imprime ni se guarda.
//   4. Integridad referencial. Para cada clave foránea se cuentan las filas
//      hijas sin padre. pg_restore ya fallaría, pero deja el número en el acta.
//
// Escribe resultado-<etiqueta>.json en --salida (default: cwd) y sale con 1
// si algo falló.
//
// Con --acta arma el texto del issue a partir de los resultado-*.json,
// los estado-*.json del workflow y los argumentos; no toca la base.
//
// Entorno (uno de los dos; si están ambos manda el llavero):
//   CLAVES_CIFRADO_IDS="1,2"   ids de TODAS las claves que existen guardadas
//                              (la del llavero de la app y las retiradas que
//                              el dueño conserva para los respaldos).
//   CLAVES_CIFRADO="1=<base64>,2=…"  el llavero completo, formato de la app.
//
// Usa `psql` (PSQL, o PG_BIN/psql, o el del PATH) y no Prisma: así el ensayo
// no depende de `npm ci` ni del cliente generado para reconocer ambos esquemas.

import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PSQL = process.env.PSQL ?? (process.env.PG_BIN ? join(process.env.PG_BIN, "psql") : "psql");
const VARIABLE_LLAVERO = "CLAVES_CIFRADO";
const VARIABLE_IDS = "CLAVES_CIFRADO_IDS";

/** Día del mes en que corre el ensayo automático, para el acta. Es el
 *  day-of-month del cron de .github/workflows/ensayo-restauracion.yml, y
 *  ensayo-restauracion.test.ts falla si los dos se separan: el acta que dice
 *  cuándo vuelve a mirarse esto no puede quedar desfasada del calendario. */
const DIA_ENSAYO = 2;

/** Filas mínimas por tabla. Una copia con menos no sirve para volver a
 *  atender: no hay a quién ni qué. */
const MINIMOS_COMUNES = {
  organizaciones: 1,
  usuarios: 1,
  pacientes: 1,
  turnos: 1,
  sesiones_clinicas: 1,
};

// La instantánea de producción es schema.prisma de d02ae0e, sin cambios.
// El contrato nuevo se deriva del schema del checkout. Se comparan TODAS
// las tablas/columnas/tipos físicos antes de consultar contenido.
const ESQUEMAS = [
  {
    id: "produccion-d02ae0e",
    archivo: join(RAIZ, "scripts/ensayo/esquema-produccion.prisma"),
    formato: "ENC1",
    minimos: { ...MINIMOS_COMUNES, paciente_contexto_clinico: 1 },
    muestras: [
      { rotulo: "nota clínica", tabla: "sesiones_clinicas", fecha: "createdAt", tipo: "nota",
        columnas: ["nota_soap_encrypted", "nota_soap_original_encrypted"] },
      // Producción conserva el contexto actual por paciente, no versiones.
      { rotulo: "contexto longitudinal", tabla: "paciente_contexto_clinico", fecha: "creado_en", tipo: "contexto",
        columnas: ["resumen_acumulativo_encrypted", "hipotesis_diagnostica_encrypted", "riesgos_historicos_encrypted"] },
    ],
  },
  {
    id: "nuevo",
    archivo: join(RAIZ, "prisma/schema.prisma"),
    formato: "ENC2",
    minimos: { ...MINIMOS_COMUNES, hilos: 1, hilo_versiones: 1 },
    muestras: [
      { rotulo: "nota clínica", tabla: "sesiones_clinicas", fecha: "creada_en", tipo: "nota",
        columnas: ["nota_final_encrypted", "nota_ia_encrypted"] },
      { rotulo: "versión del Recorrido", tabla: "hilo_versiones", fecha: "creada_en", tipo: "hilo",
        columnas: ["contenido_encrypted"] },
    ],
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

function contratoDelSchema(archivo) {
  const schema = readFileSync(archivo, "utf8");
  const tipos = { String: "text", Int: "int4", Float: "float8", Boolean: "bool", DateTime: "timestamp", Json: "jsonb", Bytes: "bytea" };
  for (const [, nombre, cuerpo] of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    tipos[nombre] = cuerpo.match(/@@map\("([^"]+)"\)/)?.[1] ?? nombre;
  }
  const tablas = {};
  for (const [, nombre, cuerpo] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const tabla = cuerpo.match(/@@map\("([^"]+)"\)/)?.[1] ?? nombre;
    tablas[tabla] = {};
    for (const linea of cuerpo.split("\n")) {
      const campo = linea.match(/^\s*(\w+)\s+(\w+)(\??)(\s+.*|\s*)$/);
      if (!campo || !tipos[campo[2]]) continue; // Relaciones, no columnas.
      const columna = campo[4].match(/@map\("([^"]+)"\)/)?.[1] ?? campo[1];
      tablas[tabla][columna] = /@db\.VarChar\(/.test(campo[4]) ? "varchar"
        : /@db\.Char\(/.test(campo[4]) ? "bpchar" : tipos[campo[2]];
    }
  }
  return tablas;
}

function detectarEsquema() {
  const catalogo = JSON.parse(sql(`SELECT coalesce(json_object_agg(tabla, columnas), '{}') FROM (
    SELECT t.table_name AS tabla,
      coalesce(json_object_agg(c.column_name, c.udt_name) FILTER (WHERE c.column_name IS NOT NULL), '{}') AS columnas
    FROM information_schema.tables t LEFT JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
    GROUP BY t.table_name) s`));
  const firma = (tablas) => JSON.stringify(Object.entries(tablas).sort().map(([tabla, columnas]) => [tabla, Object.entries(columnas).sort()]));
  return ESQUEMAS.map((e) => ({ ...e, tablas: contratoDelSchema(e.archivo) }))
    .find((e) => firma(e.tablas) === firma(catalogo)) ?? null;
}

/** Mismas reglas que src/lib/llavero.ts. Devuelve Map<id, Buffer>. */
function parsearLlavero(texto) {
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

/** "1,2" → Set de ids. Solo ids: acá no hay ningún valor de clave. */
function parsearIds(texto) {
  const ids = new Set();
  for (const cruda of texto.split(",")) {
    const e = cruda.trim();
    if (e === "") continue;
    if (!/^\d+$/.test(e) || Number(e) < 1 || Number(e) > 255) throw new Error(`${VARIABLE_IDS}: id "${e}" fuera de rango (1..255)`);
    ids.add(Number(e));
  }
  if (ids.size === 0) throw new Error(`${VARIABLE_IDS}: no tiene ningún id`);
  return ids;
}

class ErrorDescifrado extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/** Depende de con qué se corre: con el llavero (manual) o solo con ids (automático). */
const mensajeClaveAusente = (id, modo) =>
  modo === "llavero"
    ? `falta la clave ${id} en el llavero (${VARIABLE_LLAVERO}): el dato es de una época cuya clave ya no está. ` +
      `No es corrupción: agregar la clave ${id} al llavero y repetir.`
    : `hay datos cifrados con la clave ${id}, que no figura en ${VARIABLE_IDS}: es una clave retirada o desconocida y ningún llavero conocido la abre. ` +
      `No es corrupción: si la clave ${id} existe guardada aparte, agregar su id a ${VARIABLE_IDS}; si no existe, esos datos no se pueden recuperar.`;

function descifrar(blob, aad, llavero, formato) {
  if (formato === "ENC1") {
    if (blob.length < 32 || blob.subarray(0, 4).toString("ascii") !== "ENC1") {
      throw new ErrorDescifrado("formato", "no tiene el prefijo ENC1 o es demasiado corto: dato corrupto o sin cifrar");
    }
    // ENC1 no tiene id ni AAD. Solo la autenticación con una clave del
    // llavero manual puede identificarla; nunca se le inventa el id 1.
    for (const [claveId, clave] of llavero) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", clave, blob.subarray(4, 16), { authTagLength: 16 });
        decipher.setAuthTag(blob.subarray(16, 32));
        return { texto: Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]).toString("utf8"), claveId };
      } catch { /* Probar la siguiente clave conservada por el dueño. */ }
    }
    throw new ErrorDescifrado("autenticacion", "ENC1 no descifra con ninguna clave del llavero: falta la clave correcta o el dato está alterado");
  }
  if (blob.length < POS_CT || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new ErrorDescifrado("formato", "no tiene el prefijo ENC2 o es demasiado corto: dato corrupto o sin cifrar");
  }
  const id = blob[POS_ID];
  const clave = llavero.get(id);
  if (!clave) throw new ErrorDescifrado("clave_ausente", mensajeClaveAusente(id, "llavero"));
  const decipher = createDecipheriv("aes-256-gcm", clave, blob.subarray(POS_IV, POS_TAG), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(blob.subarray(POS_TAG, POS_CT));
  try {
    return { texto: Buffer.concat([decipher.update(blob.subarray(POS_CT)), decipher.final()]).toString("utf8"), claveId: id };
  } catch {
    throw new ErrorDescifrado(
      "autenticacion",
      `no descifra con la clave ${id}: dato corrupto o alterado (o la clave ${id} del llavero no es la de esa época)`,
    );
  }
}

// ─── 1. Filas por tabla ─────────────────────────────────────────────────────

function contarFilas(tablas, minimos) {
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
    const minimo = minimos[t] ?? 0;
    if (n === 0 && minimo > 0) problemas.push(`tabla ${t} vacía: 0 filas, el mínimo es ${minimo}`);
    else if (n < minimo) problemas.push(`${t}: ${n} filas, el mínimo es ${minimo}`);
  }
  return { conteos, problemas };
}

// ─── 2. Cifrado en reposo: prefijo e ids de clave ───────────────────────────

function verificarCifrado(idsConocidos, modo, formato) {
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
  let sinId = 0;

  for (const col of columnas) {
    const [tabla, columna] = col.split(".");
    const [ids, malos] = sql(
      `SELECT coalesce(json_object_agg(id, n) FILTER (WHERE id IS NOT NULL), '{}'),
              coalesce(sum(n) FILTER (WHERE id IS NULL), 0)
       FROM (SELECT CASE WHEN length("${columna}") >= ${formato === "ENC1" ? 32 : POS_CT}
                          AND substring("${columna}" from 1 for 4) = '${formato === "ENC1" ? "\\x454e4331" : "\\x454e4332"}'::bytea
                         THEN ${formato === "ENC1" ? "0" : `get_byte("${columna}", ${POS_ID})`} END AS id, count(*) AS n
             FROM "${tabla}" WHERE "${columna}" IS NOT NULL GROUP BY 1) s`,
    ).split("|");
    const porClaveCol = Object.fromEntries(Object.entries(JSON.parse(ids)).map(([k, v]) => [Number(k), Number(v)]));
    const sinIdCol = formato === "ENC1" ? (porClaveCol[0] ?? 0) : 0;
    if (formato === "ENC1") delete porClaveCol[0];
    sinId += sinIdCol;
    detalle[col] = { porClave: porClaveCol, sinId: sinIdCol, otros: Number(malos) };
    otros += Number(malos);
    if (Number(malos) > 0) problemas.push(`${col}: ${malos} valor(es) sin prefijo ${formato} o demasiado cortos: dato corrupto o sin cifrar`);
    for (const [id, n] of Object.entries(porClaveCol)) {
      porClave[id] = (porClave[id] ?? 0) + n;
      if (!idsConocidos.has(Number(id))) {
        clavesAusentes.add(Number(id));
        problemas.push(`${col}: ${n} valor(es): ${mensajeClaveAusente(id, modo)}`);
      }
    }
  }

  return { formato, columnas: columnas.length, porClave, sinId, otros, clavesAusentes: [...clavesAusentes].sort(), detalle, problemas };
}

// ─── 3. Muestras: elegir siempre, descifrar solo con llavero ──────────────────────────────────────────────

function elegirMuestras(llavero, idsConocidos, esquema) {
  const muestras = [];
  const problemas = [];

  for (const def of esquema.muestras) {
    const columna = def.columnas.find(
      (c) => Number(sql(`SELECT count(*) FROM "${def.tabla}" WHERE "${c}" IS NOT NULL`)) > 0,
    );
    if (!columna) {
      const ausencia = def.tipo === "contexto" ? "no hay contexto longitudinal" : `no hay ninguna ${def.rotulo}`;
      problemas.push(`${ausencia} en la copia (${def.tabla}.${def.columnas.join("/")} todas NULL): nada que descifrar`);
      continue;
    }
    for (const orden of ["ASC", "DESC"]) {
      const [id, hex] = sql(
        `SELECT id, encode("${columna}", 'hex') FROM "${def.tabla}"
         WHERE "${columna}" IS NOT NULL ORDER BY "${def.fecha}" ${orden}, id ${orden} LIMIT 1`,
      ).split("|");
      const blob = Buffer.from(hex, "hex");
      const muestra = {
        rotulo: def.rotulo,
        tabla: def.tabla,
        columna,
        id,
        cual: orden === "ASC" ? "más vieja" : "más nueva",
        formato: esquema.formato,
        claveId: esquema.formato === "ENC2" && blob.length >= POS_CT && blob.subarray(0, 4).equals(MAGIC) ? blob[POS_ID] : null,
        /** true/false si se intentó descifrar; null en el ensayo automático. */
        descifrada: null,
        ok: false,
      };
      muestra.ok = esquema.formato === "ENC1" ? null : muestra.claveId !== null && idsConocidos.has(muestra.claveId);
      if (!llavero) {
        muestras.push(muestra);
        continue;
      }
      try {
        const { texto, claveId } = descifrar(blob, `${def.tabla}:${columna}:${id}`, llavero, esquema.formato);
        muestra.claveId = claveId;
        let valor;
        try {
          valor = def.tipo === "contexto" && columna !== "riesgos_historicos_encrypted" ? texto : JSON.parse(texto);
        } catch {
          throw new ErrorDescifrado("contenido", "descifra, pero el texto no es JSON");
        }
        const valido = def.tipo === "nota"
          ? valor !== null && typeof valor === "object" && ["subjetivo", "objetivo", "analisis", "plan"].every((k) => k in valor)
          : def.tipo === "hilo" ? valor !== null && typeof valor === "object" && !Array.isArray(valor)
            : columna === "riesgos_historicos_encrypted" ? Array.isArray(valor) : typeof valor === "string";
        if (!valido) throw new ErrorDescifrado("contenido", "descifra, pero el contenido no tiene la forma esperada");
        muestra.descifrada = true;
        muestra.ok = true;
      } catch (error) {
        if (!(error instanceof ErrorDescifrado)) throw error;
        muestra.descifrada = false;
        muestra.ok = false;
        muestra.codigo = error.codigo;
        muestra.error = error.message;
        problemas.push(`${def.rotulo} ${muestra.cual} (${def.tabla}.${columna} ${id}): ${error.message}`);
      }
      muestras.push(muestra);
    }
  }
  return { modo: llavero ? "llavero" : "ids", idsConocidos: [...idsConocidos].sort((a, b) => a - b), muestras, problemas };
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
  const rutaEstado = join(SALIDA, `estado-${etiqueta}.json`);
  const estado = existsSync(rutaEstado) ? JSON.parse(readFileSync(rutaEstado, "utf8")) : null;
  const titulo = { diario: "Copia diaria (la más reciente)", mensual: "Copia mensual (la más vieja)" }[etiqueta] ?? `Copia ${etiqueta}`;
  const lineas = [`### ${titulo}: \`${archivo ?? r?.archivo ?? estado?.archivo ?? "no identificada"}\``, ""];
  if (!r) {
    const etapas = {
      no_existe: "No existe la copia bajo el prefijo consultado. No se descargó ni se abrió.",
      listado: "Falló el listado de copias. No se pudo determinar si existe la copia.",
      metadatos: "Falló la lectura de la fecha de la copia. No se descargó ni se abrió.",
      descarga: "Falló la descarga de la copia. No se intentó abrirla.",
      base: "Falló la preparación de la base destino. No se intentó abrir la copia.",
      apertura: "La copia falló al abrirse o restaurarse. El registro no distingue aquí entre descifrado, índice y restauración: ver el error de la corrida.",
      verificacion: "Falló la verificación después de restaurar la copia, sin generar un resultado detallado. Ver el error de la corrida.",
    };
    const mensaje = Number.isInteger(estado?.codigo) && estado.codigo !== 0
      ? etapas[estado.etapa]
      : null;
    lineas.push(`_${mensaje ?? "No hay resultado ni un fallo registrado que explique su ausencia. La causa es desconocida; ver la corrida."}_`, "");
    return lineas;
  }
  lineas.push(`- **Fecha del respaldo:** ${r.fechaArchivo ?? "?"}`, `- **Resultado de la verificación:** ${r.ok ? "OK" : "FALLÓ"}`);
  if (r.esquema) lineas.push(`- **Esquema restaurado:** ${r.esquema}`);
  if (r.tablas) {
    lineas.push("", "| Tabla | Filas |", "| --- | --- |");
    for (const [t, n] of Object.entries(r.tablas.conteos)) lineas.push(`| ${t} | ${n ?? "no existe"} |`);
  }
  if (!r.cifrado || !r.descifrado || !r.fk) {
    lineas.push("", "**Problemas:**", "", ...r.problemas.map((p) => `- ${p}`), "");
    return lineas;
  }
  const claves = Object.entries(r.cifrado.porClave).map(([id, n]) => `clave ${id}: ${n}`).join(", ") || "ninguna";
  lineas.push(
    "",
    `- **Cifrado:** ${r.cifrado.columnas} columnas \`*_encrypted\`; formato ${r.cifrado.formato ?? "ENC2"}; blobs por clave: ${claves}; formato inválido: ${r.cifrado.otros}` +
      (r.cifrado.clavesAusentes.length ? `; **claves que faltan en el llavero: ${r.cifrado.clavesAusentes.join(", ")}**` : ""),
    `- **Ids de clave conocidos (${r.descifrado.modo === "llavero" ? "del llavero" : VARIABLE_IDS}):** ${r.descifrado.idsConocidos.join(", ")} (nunca los valores)`,
  );
  if (r.cifrado.formato === "ENC1") {
    lineas.push(`- **Límite de ENC1:** ${r.cifrado.sinId} blobs sin identificador de clave. El automático comprueba el formato, pero no puede identificar ni confirmar la clave; lo prueba el ensayo manual con el llavero.`);
    lineas.push("- **Recorrido de producción:** contexto actual por paciente; este esquema no conserva versiones históricas.");
  }
  for (const m of r.descifrado.muestras) {
    const nombre = `${m.rotulo[0].toUpperCase()}${m.rotulo.slice(1)} ${m.cual}`;
    const donde = `${m.tabla} \`${m.id}\`, clave ${m.claveId ?? "?"}`;
    if (m.descifrada === null) {
      lineas.push(m.formato === "ENC1"
        ? `- **${nombre}:** ${m.tabla} \`${m.id}\`; ENC1 sin id de clave. Descifrado no probado en el automático.`
        : `- **${nombre}:** ${donde}; clave ${m.ok ? "conocida" : "DESCONOCIDA"}. No se descifra en el ensayo automático: lo hace el trimestral a mano.`);
    } else {
      lineas.push(`- **${nombre} descifrada y leída:** ${m.descifrada ? "sí" : "NO"} (${donde}${m.descifrada ? "" : `; ${m.codigo}: ${m.error}`})`);
    }
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
    "El ensayo automático descifra el archivo de respaldo, pero no las notas clínicas: la clave clínica no está en GitHub Actions. " +
      "Comprueba filas, formato cifrado y claves foráneas; en ENC2 también contrasta los ids de clave. ENC1 no incluye esos ids. " +
      "El descifrado clínico se prueba A MANO con el llavero (scripts/ensayo/ensayo-manual.sh, docs/operaciones.md §4). " +
      "Cada copia indica arriba qué se pudo verificar y qué falló.",
    "",
    `### Próximo ensayo automático: el día ${DIA_ENSAYO} del mes que viene.`,
    "",
  ].join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

let llavero = null;
let idsConocidos;
try {
  if (process.env[VARIABLE_LLAVERO]?.trim()) {
    llavero = parsearLlavero(process.env[VARIABLE_LLAVERO]);
    idsConocidos = new Set(llavero.keys());
  } else if (process.env[VARIABLE_IDS]?.trim()) {
    idsConocidos = parsearIds(process.env[VARIABLE_IDS]);
  } else {
    throw new Error(
      `falta ${VARIABLE_IDS} (ensayo automático: ids de las claves conocidas, sin valores) o ${VARIABLE_LLAVERO} (ensayo manual: el llavero, que además descifra).`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const resultado = {
  fecha: new Date().toISOString(),
  etiqueta: ETIQUETA,
  archivo: process.env.BACKUP_ARCHIVO ?? null,
  fechaArchivo: process.env.BACKUP_FECHA ?? null,
  esquema: "no determinado",
  tablas: null,
  cifrado: null,
  descifrado: null,
  fk: null,
  problemas: [],
  ok: false,
};
let etapa = "detección del esquema";
try {
  const esquema = detectarEsquema();
  if (!esquema) {
    resultado.esquema = "desconocido";
    resultado.problemas.push("esquema restaurado desconocido: las tablas, columnas o tipos no coinciden con producción (d02ae0e) ni con el esquema nuevo");
  } else {
    resultado.esquema = esquema.id;
    etapa = "conteo de filas";
    resultado.tablas = contarFilas(Object.keys(esquema.tablas), esquema.minimos);
    resultado.problemas.push(...resultado.tablas.problemas);
    etapa = "censo de cifrado";
    resultado.cifrado = verificarCifrado(idsConocidos, llavero ? "llavero" : "ids", esquema.formato);
    resultado.problemas.push(...resultado.cifrado.problemas);
    etapa = "selección y verificación de muestras";
    resultado.descifrado = elegirMuestras(llavero, idsConocidos, esquema);
    resultado.problemas.push(...resultado.descifrado.problemas);
    etapa = "verificación de claves foráneas";
    resultado.fk = verificarClavesForaneas();
    resultado.problemas.push(...resultado.fk.problemas);
    resultado.ok = resultado.problemas.length === 0;
  }
} catch {
  // El error de psql ya está en stderr. No copiar el Error de execFileSync:
  // contiene la URL de conexión, que puede tener credenciales.
  resultado.problemas.push(`no se pudo completar ${etapa}; ver el error de la corrida`);
}
writeFileSync(join(SALIDA, `resultado-${ETIQUETA}.json`), JSON.stringify(resultado, null, 2));

const { tablas: filas, cifrado, descifrado, fk, problemas } = resultado;
console.log(`[${ETIQUETA}] esquema restaurado: ${resultado.esquema}`);
if (filas && cifrado && descifrado && fk) {
  console.log(
    `[${ETIQUETA}] tablas: ${Object.keys(filas.conteos).length}; columnas cifradas: ${cifrado.columnas} (${cifrado.formato}, sin id ${cifrado.sinId}, por clave ${JSON.stringify(cifrado.porClave)}, inválidos ${cifrado.otros}); ` +
      (llavero
        ? `muestras descifradas: ${descifrado.muestras.filter((m) => m.descifrada).length}/${descifrado.muestras.length}`
        : cifrado.formato === "ENC1" ? "muestras ENC1 sin id: clave no identificable (sin descifrar)"
          : `muestras con clave conocida: ${descifrado.muestras.filter((m) => m.ok).length}/${descifrado.muestras.length} (sin descifrar)`) +
      `; FK: ${fk.constraints}, violaciones ${fk.violaciones}`,
  );
  for (const [t, n] of Object.entries(filas.conteos)) console.log(`  ${t}: ${n ?? "NO EXISTE"}`);
  for (const m of descifrado.muestras) {
    const estado = m.descifrada === null
      ? m.formato === "ENC1" ? "ENC1 sin id, clave no probada" : m.ok ? "clave conocida, sin descifrar" : "clave DESCONOCIDA"
      : m.descifrada ? "descifrada y leída" : m.codigo;
    console.log(`  ${m.rotulo} ${m.cual} (${m.tabla} ${m.id}, clave ${m.claveId ?? "?"}): ${estado}`);
  }
}

if (problemas.length > 0) {
  console.error("\nProblemas:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nrestauración verificada: OK");
