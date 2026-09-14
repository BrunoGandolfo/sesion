// Guardián de `maxDuration`: toda ruta de API tiene que declarar su techo.
//
// POR QUÉ
//
// Una función sin `maxDuration` corre con el default del plan de Vercel, que
// no está escrito en ningún lado del repositorio y cambia con el plan. En la
// auditoría de septiembre de 2026 sólo 2 de 41 rutas lo declaraban; entre
// las otras 39 estaban las que firman contra R2, las que borran en R2, la
// que hace stream de Anthropic y el cron de salud. Un techo explícito es lo
// que hace que un proveedor lento termine en un 504 con diagnóstico y no en
// una función cortada a la mitad de una transacción.
//
// LA CONVENCIÓN (segundos)
//
//   Lecturas de UI (GET)                         15   una consulta y un mapper
//   Escrituras de UI (POST/PATCH/DELETE)         30   puede llevar transacción
//   Que hablan con R2 (upload-url, aprobar…)     30   una llamada de red externa
//   ayuda (stream de Anthropic)                  60   es el techo del stream
//   Crons                                        60   presupuesto explícito
//   M2M del worker (pendientes, callback…)       60   lotes
//
// Una ruta con GET y escritura toma el mayor de los dos. Este script NO
// verifica la familia (eso es criterio, no sintaxis): verifica que la
// declaración exista, sea un entero y esté dentro del techo que Vercel
// admite. Es lo mismo que hace middleware-edge.test.ts con los imports: una
// convención que se comprueba sola en vez de recordarse.
//
// Uso: `node scripts/ci/max-duration.mjs` (sale con 1 si falta alguna).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = process.cwd();
const BASE = join(RAIZ, "src", "app", "api");

/** Techo que acepta Vercel para funciones de Node en el plan Pro. */
const MAXIMO = 300;

function rutas(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...rutas(ruta));
    else if (nombre === "route.ts" || nombre === "route.js") out.push(ruta);
  }
  return out;
}

// El inicializador completo, no un prefijo: `30.5`, `3e3` o `30 * 100` no
// pasan. Un comentario al final de la línea sí.
const DECLARACION = /^export const maxDuration\s*=\s*(\d+)\s*;\s*(?:\/\/.*)?$/m;

const problemas = [];
const archivos = rutas(BASE);

for (const archivo of archivos) {
  const fuente = readFileSync(archivo, "utf8");
  const rel = relative(RAIZ, archivo);
  const m = fuente.match(DECLARACION);
  if (!m) {
    problemas.push(`${rel}: no declara \`export const maxDuration = <segundos>;\``);
    continue;
  }
  const valor = Number(m[1]);
  if (!Number.isInteger(valor) || valor < 1 || valor > MAXIMO) {
    problemas.push(`${rel}: maxDuration = ${m[1]} no es un entero entre 1 y ${MAXIMO}`);
  }
}

if (archivos.length === 0) {
  console.error(`No se encontró ninguna ruta en ${relative(RAIZ, BASE)}: el guardián no miró nada.`);
  process.exit(1);
}

if (problemas.length > 0) {
  console.error("Rutas de API sin techo de tiempo válido:\n");
  for (const p of problemas) console.error(`  - ${p}`);
  console.error(
    "\nToda ruta declara `export const maxDuration` (segundos). La convención está en el encabezado de scripts/ci/max-duration.mjs.",
  );
  process.exit(1);
}

console.log(`maxDuration: ${archivos.length} rutas declaradas, todas dentro de 1..${MAXIMO} s.`);
