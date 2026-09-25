// Los nombres viejos de la app no vuelven al recorrido ni a la ayuda.
//
// La pestaña de datos se llamó "Ficha", el brief de la ficha "Para retomar",
// el botón de Cobros "Recordar cobro" a secas, el Recorrido "El hilo", y "Para
// vos" abría con la "Adherencia global" arriba y un selector de dos opciones.
// Hoy son "Datos", "Preparar sesión", "Recordar cobro por SMS", "Recorrido",
// el instrumento plegado al final y un selector de tres.
//
// Cada aparición que queda está acá con su motivo: si alguien agrega otra, o
// saca una de estas, el test lo muestra y hay que decidir.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMO_VA,
  DATOS,
  PREPARAR_SESION,
  RECORDAR_COBRO,
} from "../../src/lib/glosario";
import { DURACIONES } from "../../src/lib/constantes-turno";
import { ARCHIVOS_CORPUS } from "../../src/lib/ayuda-corpus";

const RAIZ = join(import.meta.dirname, "..", "..");

// Todas las páginas de ayuda —la misma lista que lee Lupita, así una página
// nueva entra sola— y el recorrido automático.
const ARCHIVOS = [
  ...ARCHIVOS_CORPUS.map((n) => `docs/ayuda/${n}`),
  "pruebas/e2e/recorrido.mjs",
  "pruebas/e2e/README.md",
];

// Los espacios valen como cualquier blanco: en la ayuda un nombre puede
// quedar partido entre dos líneas.
const VIEJOS = new RegExp(
  ["Ficha", "Para retomar", "Recordar cobro(?!\\s+por\\s+SMS)", "Cómo va", "El hilo", "Adherencia global",
    "selector de dos opciones", "\\*\\*Terapeuta\\*\\*", "\\*\\*Paciente\\*\\*"]
    .map((v) => v.replaceAll(" ", "\\s+"))
    .join("|"),
  "g",
);
const plano = (t) => t.replace(/\s+/g, " ");

// [archivo, nombre, fragmento de la línea] — por qué está bien.
const PERMITIDOS = [
  // "Ficha" es la página de la paciente (Ver ficha, Volver a la ficha); los
  // pasos nombran la página, y la pestaña se busca como "Datos".
  ["pruebas/e2e/recorrido.mjs", "Ficha", "paso('Ficha: Sesiones'"],
  ["pruebas/e2e/recorrido.mjs", "Ficha", "paso('Ficha: Recorrido'"],
  ["pruebas/e2e/recorrido.mjs", "Ficha", "paso('Ficha: Datos, autorización y pagos'"],
  // Dice cómo se llamaba, para quien lo busque con el nombre viejo.
  ["docs/ayuda/04-pacientes-y-ficha.md", "Ficha", "Se llamaba **Ficha**."],
  // El bloque de indicadores en el PDF del Recorrido se titula así.
  ["docs/ayuda/10-el-hilo-y-el-recorrido.md", "Cómo va", "En el PDF este bloque se titula **Cómo va**."],
  ["docs/ayuda/10-el-hilo-y-el-recorrido.md", "Cómo va", "- **Cómo va**, con todas las sesiones"],
  ["docs/ayuda/10-el-hilo-y-el-recorrido.md", "Cómo va", "En **Cómo va** no se"],
  // La Adherencia global existe: es lo primero al abrir el instrumento.
  ["docs/ayuda/09-para-vos-feedback.md", "Adherencia global", "**Adherencia global**: *\"13 de 18"],
];

/** Cada aparición con su nombre normalizado, su línea y el contexto (la
 *  línea donde empieza y la siguiente, en una sola) contra el que se compara
 *  el fragmento permitido. */
function apariciones() {
  const halladas = [];
  for (const archivo of ARCHIVOS) {
    const texto = readFileSync(join(RAIZ, archivo), "utf8");
    const lineas = texto.split("\n");
    for (const m of texto.matchAll(VIEJOS)) {
      const i = texto.slice(0, m.index).split("\n").length - 1;
      const contexto = plano(lineas.slice(i, i + 2).join(" "));
      halladas.push({ archivo, nombre: plano(m[0]), contexto, n: i + 1 });
    }
  }
  return halladas;
}

describe("nombres vigentes en el recorrido y la ayuda", () => {
  it("cada nombre viejo que queda es un uso verificado, y no falta ninguno de los verificados", () => {
    const halladas = apariciones();
    const sinPermiso = halladas
      .filter((h) => !PERMITIDOS.some(([a, n, f]) => a === h.archivo && n === h.nombre && h.contexto.includes(f)))
      .map((h) => `${h.archivo}:${h.n} «${h.nombre}»: ${h.contexto.trim()}`);
    expect(sinPermiso).toEqual([]);
    const sinUso = PERMITIDOS.filter(([a, n, f]) => !halladas.some((h) => h.archivo === a && h.nombre === n && h.contexto.includes(f)));
    expect(sinUso).toEqual([]);
  });

  it("«Cómo va» sigue siendo el título del bloque en el PDF", () => {
    expect(COMO_VA).toBe("Cómo va");
  });

  it("el recorrido abre la pestaña con el nombre que tiene", () => {
    const recorrido = readFileSync(join(RAIZ, "pruebas/e2e/recorrido.mjs"), "utf8");
    const pestanas = [...recorrido.matchAll(/getByRole\('tab', \{ name: '([^']+)'/g)].map((m) => m[1]);
    expect(pestanas.filter((p) => p === DATOS)).toHaveLength(2);
    expect(pestanas).not.toContain("Ficha");
  });

  it("la ayuda nombra los botones como se llaman hoy", () => {
    const leer = (n) => readFileSync(join(RAIZ, "docs/ayuda", n), "utf8");
    for (const pagina of ["00-que-es-sesion.md", "05-cobros.md", "06-recordatorios-sms.md", "11-tu-consultorio.md", "_indice.md"]) {
      expect(leer(pagina), pagina).toContain(RECORDAR_COBRO);
    }
    expect(leer("10-el-hilo-y-el-recorrido.md")).toContain(`**${PREPARAR_SESION}**, en la pestaña **Sesiones**`);
    expect(leer("09-para-vos-feedback.md")).toContain("selector de tres opciones");
    expect(leer("03-agenda-y-turnos.md")).toContain(`**"${PREPARAR_SESION}"**`);
  });

  it("la agenda ofrece en la ayuda las mismas duraciones que el formulario", () => {
    const texto = plano(readFileSync(join(RAIZ, "docs/ayuda/03-agenda-y-turnos.md"), "utf8"));
    const lista = `${DURACIONES.slice(0, -1).join(", ")} o ${DURACIONES.at(-1)} minutos`;
    expect(texto).toContain(`**Duración**: ${lista}.`);
  });
});
