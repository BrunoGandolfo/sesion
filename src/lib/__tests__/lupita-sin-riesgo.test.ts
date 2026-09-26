// Guardián de la regla dura de Lupita (docs/diseno/06-lupita-presencia.md,
// R1, y 04-personaje.md, "la regla de tono"): ninguna Lupita en el camino de
// una sesión con riesgo. Lo más cerca que puede estar el personaje de un
// dato clínico es el borde, y en las pantallas clínicas ni eso (06, D3).
//
// Cómo se sostiene en código, y qué mira este test:
//
//   1. Las superficies clínicas —la nota entera, la ficha entera (con el
//      Recorrido y sus gráficos), el brief y su uso en la card de Hoy, el
//      bloque de riesgo y los componentes clínicos— no DIBUJAN a Lupita: no
//      importan el dibujo ni la posada, no escriben `<Lupita`, y no le
//      piden al "procesando" que la muestre (`conLupita`). Sí pueden
//      importar el almacén (`@/lib/lupita-presencia`): así la nota avisa
//      que se aprobó sin dibujar nada.
//   2. La nota avisa la aprobación sólo si la sesión no trae ninguna señal
//      de riesgo (`clavesDeRiesgo` vacío).
//   3. El almacén no importa nada de la app: es lo único que esas pantallas
//      pueden tocar, y no puede arrastrar el dibujo por atrás.
//
// Un import del índice `@/components/ui` no se prohíbe (lo reexporta, pero
// de ahí salen Button y Card); lo que se prohíbe es usar el dibujo.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

const CLINICAS = [
  "src/app/(dashboard)/sesiones/[id]",
  "src/app/(dashboard)/pacientes/[id]",
  "src/app/(impresion)",
  "src/components/clinico",
  "src/app/(dashboard)/_components/card-ahora.tsx",
  "src/components/grabacion/RiesgoDetectadoBanner.tsx",
];

function fuentes(relativo: string): string[] {
  const absoluto = path.join(RAIZ, relativo);
  if (!statSync(absoluto).isDirectory()) return [relativo];
  return readdirSync(absoluto).flatMap((nombre) => {
    if (nombre === "__tests__") return [];
    const hijo = path.join(relativo, nombre);
    if (statSync(path.join(RAIZ, hijo)).isDirectory()) return fuentes(hijo);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre) ? [hijo] : [];
  });
}

/** Todo archivo con "brief" en el nombre, esté donde esté. */
function briefs(dir = "src"): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((nombre) => {
    const hijo = path.join(dir, nombre);
    if (statSync(path.join(RAIZ, hijo)).isDirectory()) return nombre === "__tests__" ? [] : briefs(hijo);
    return /brief/i.test(nombre) && /\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre) ? [hijo] : [];
  });
}

const leer = (relativo: string) => readFileSync(path.join(RAIZ, relativo), "utf8");

const DIBUJO = [
  /from\s+["'][^"']*components\/ui\/lupita["']/,
  /from\s+["']\.{1,2}\/(?:[^"']*\/)?lupita["']/,
  /from\s+["'][^"']*presencia-lupita["']/,
  /<Lupita\b/,
  /\bconLupita\b/,
];

describe("Lupita no entra en las superficies clínicas", () => {
  const archivos = [...new Set([...CLINICAS.flatMap((c) => fuentes(c)), ...briefs()])];

  it("la lista cubre la nota, la ficha, el Recorrido, el brief y el bloque de riesgo", () => {
    expect(archivos.some((a) => a.includes("sesion-detail-view.tsx"))).toBe(true);
    expect(archivos.some((a) => a.includes("recorrido-tab.tsx"))).toBe(true);
    expect(archivos.some((a) => a.includes("graficos/"))).toBe(true);
    expect(archivos.some((a) => a.includes("brief-corto.tsx"))).toBe(true);
    expect(archivos.some((a) => a.includes("brief-pre-sesion.tsx"))).toBe(true);
    expect(archivos.some((a) => a.includes("RiesgoDetectadoBanner.tsx"))).toBe(true);
  });

  it.each(DIBUJO.map((patron) => [String(patron), patron] as const))("ninguna escribe %s", (_nombre, patron) => {
    const culpables = archivos.filter((a) => patron.test(leer(a)));
    expect(culpables).toEqual([]);
  });

  it("la nota avisa la aprobación sólo sin señal de riesgo", () => {
    const nota = leer("src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx");
    const llamadas = nota.match(/avisarLupita\(/g) ?? [];
    expect(llamadas).toHaveLength(1);
    expect(nota).toMatch(/if \(\s*clavesRiesgo\.length === 0 &&\s*clavesDeRiesgo\([^)]*\)\.length === 0\s*\)\s*\{\s*avisarLupita\("aprobada"\);/);
  });

  it("el almacén que sí pueden importar no importa nada de la app", () => {
    const almacen = leer("src/lib/lupita-presencia.ts");
    expect(almacen).not.toMatch(/^\s*import\s/m);
  });
});
