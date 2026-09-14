// Guardián del ensayo de restauración.
//
// Un backup que nunca se restauró no es un backup, es una esperanza. El
// ensayo automático mensual (.github/workflows/ensayo-restauracion.yml)
// prueba que el dump se restaura y sigue cifrado; el ensayo A MANO,
// trimestral, prueba que la clave todavía abre una nota, y deja un acta en
// docs/operaciones/actas/AAAA-MM-DD-<lo que sea>.md (la plantilla está al
// lado). Este guardián falla si el acta más reciente tiene más de MAX_DIAS:
// es la única forma de que "se repite en calendario" no dependa de que
// alguien se acuerde.
//
// Mientras no exista NINGÚN acta (el primer ensayo está pendiente), avisa
// pero no falla, hasta la fecha límite de abajo. Un CI rojo permanente desde
// el primer día se aprende a ignorar, que es peor que no tenerlo; una fecha
// límite escrita es una promesa que se puede verificar.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "docs", "operaciones", "actas");

/** Trimestral (90 días) más diez de holgura para que el aviso no caiga en
 *  medio de unas vacaciones. */
const MAX_DIAS = 100;

/** Hasta cuándo se tolera que no haya ningún acta. Cien días desde que este
 *  guardián entró (11 de septiembre de 2026). */
const LIMITE_PRIMER_ACTA = new Date("2026-12-20T00:00:00Z");

const NOMBRE = /^(\d{4})-(\d{2})-(\d{2}).*\.md$/;

const hoy = new Date();
const dia = 24 * 60 * 60 * 1000;

const actas = existsSync(DIR)
  ? readdirSync(DIR)
      .map((n) => ({ nombre: n, m: n.match(NOMBRE) }))
      .filter((a) => a.m)
      .map((a) => ({ nombre: a.nombre, fecha: new Date(`${a.m[1]}-${a.m[2]}-${a.m[3]}T00:00:00Z`) }))
      .filter((a) => !Number.isNaN(a.fecha.getTime()))
      .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
  : [];

if (actas.length === 0) {
  const msg =
    "No hay ningún acta de ensayo de restauración en docs/operaciones/actas/. " +
    "Hasta que exista una, este sistema no tiene una restauración probada.";
  if (hoy.getTime() > LIMITE_PRIMER_ACTA.getTime()) {
    console.error(`✗ ${msg} La fecha límite para el primer ensayo (${LIMITE_PRIMER_ACTA.toISOString().slice(0, 10)}) ya pasó.`);
    process.exit(1);
  }
  console.warn(`⚠ ${msg} Fecha límite del primer ensayo: ${LIMITE_PRIMER_ACTA.toISOString().slice(0, 10)}.`);
  process.exit(0);
}

const ultima = actas[0];
const edad = Math.floor((hoy.getTime() - ultima.fecha.getTime()) / dia);

if (edad > MAX_DIAS) {
  console.error(
    `✗ El acta de restauración más reciente (${ultima.nombre}) tiene ${edad} días; el máximo es ${MAX_DIAS}. ` +
      "Hay que hacer el ensayo a mano (docs/operaciones.md §4) y dejar el acta.",
  );
  process.exit(1);
}

console.log(`acta de restauración vigente: ${ultima.nombre} (${edad} días).`);
