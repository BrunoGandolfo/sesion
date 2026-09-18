// Unitario — lo que el prompt de Lupita escribe por su cuenta, contra el código.
//
// La ayuda (docs/ayuda/) tiene su propia prueba en ayuda-vigente.test.ts. Este
// archivo cubre lo que NO sale de la ayuda: los ejemplos de voz de
// src/lib/ayuda-corpus.ts. Un ejemplo con un botón retirado le enseña a Lupita
// a nombrarlo aunque la ayuda ya no lo mencione: pasó con "Terminar y enviar".
//
// Mismo criterio que la prueba de la ayuda: cada afirmación se ata a la línea
// de código que la hace verdadera, leída del disco.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { EJEMPLOS_DE_VOZ, olvidarCorpus, systemPromptAyuda } from "@/lib/ayuda-corpus";

const RAIZ = process.cwd();
const codigo = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Todo el código de la app que puede dibujar un texto, sin tests ni el propio corpus. */
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !ruta.endsWith("ayuda-corpus.ts") ? [ruta] : [];
  });
}

/** Los ejemplos buenos: lo que está antes de "Ejemplos malos". */
function ejemplosBuenos(): string[] {
  const corte = EJEMPLOS_DE_VOZ.findIndex((e) => e.startsWith("Ejemplos malos"));
  return EJEMPLOS_DE_VOZ.slice(1, corte);
}

/** Los nombres entre comillas de las respuestas buenas: son botones o pantallas. */
function nombresCitados(): string[] {
  return ejemplosBuenos().flatMap((ejemplo) => {
    const respuesta = ejemplo.slice(ejemplo.indexOf("Respuesta:"));
    return [...respuesta.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  });
}

beforeEach(() => {
  olvidarCorpus();
});

describe("los ejemplos de voz de Lupita", () => {
  it("van dentro del prompt", () => {
    const prompt = systemPromptAyuda();
    for (const ejemplo of EJEMPLOS_DE_VOZ) expect(prompt).toContain(ejemplo);
  });

  it("cada botón o pantalla que nombran existe en el código de la app", () => {
    const textos = [
      ...fuentes(join(RAIZ, "src/app")),
      ...fuentes(join(RAIZ, "src/components")),
      ...fuentes(join(RAIZ, "src/lib")),
    ].map((ruta) => ({ ruta: relative(RAIZ, ruta), texto: readFileSync(ruta, "utf8") }));

    const nombres = nombresCitados();
    expect(nombres.length).toBeGreaterThanOrEqual(5);
    for (const nombre of nombres) {
      const donde = textos.find((f) => f.texto.includes(nombre));
      expect(donde, `"${nombre}" no aparece en el código de la app`).toBeDefined();
    }
  });

  it("no enseñan botones retirados ni nombres recortados", () => {
    const texto = ejemplosBuenos().join("\n");
    expect(texto).not.toMatch(/"Terminar y enviar"|"Reanudar grabación"|"Lo que cobrás"/);
  });

  it("la tarifa: se guarda sola y los turnos ya cargados conservan la suya", () => {
    const tarifa = ejemplosBuenos().find((e) => e.includes("¿Dónde cambio la tarifa?"))!;
    const configuracion = codigo("src/app/(dashboard)/config/_components/config-view.tsx");
    expect(configuracion).toContain("<TituloSeccion>Lo que cobrás por sesión</TituloSeccion>");
    // Autoguardado: no hay botón de guardar en Tu consultorio.
    expect(configuracion).toContain("1500");
    expect(tarifa).toContain("se guarda sola");
    // Cada turno copia la tarifa de la paciente al crearse.
    expect(codigo("src/app/api/_lib/casos-uso/crear-turno.ts")).toContain("tarifaCobrada: paciente.tarifa");
    expect(tarifa).toContain("conservan la tarifa que tenían");
  });

  it("el recordatorio: el momento se calcula al programar el aviso del turno", () => {
    const recordatorio = ejemplosBuenos().find((e) => e.includes("¿Cómo mando un recordatorio?"))!;
    expect(codigo("src/app/(dashboard)/config/_components/config-view.tsx")).toContain("<TituloSeccion>Recordatorio</TituloSeccion>");
    expect(codigo("src/app/api/_lib/casos-uso/envios-del-turno.ts")).toContain("calcularProgramadoEn(fechaTurno");
    expect(recordatorio).toContain("vale para los turnos que agendes o reprogrames");
  });

  it("la grabación cortada: lo guardado queda en el teléfono y los botones son los del grabador", () => {
    const grabacion = ejemplosBuenos().find((e) => e.includes("¿Qué pasa si se corta la grabación?"))!;
    const storage = codigo("src/lib/grabacion-storage.ts");
    // Cada chunk se guarda apenas llega, tal cual: la app no cifra el audio.
    expect(storage).toContain("const registro: ChunkGrabacion = { sesionClinicaId, indice, blob: chunk };");
    expect(grabacion).toContain("queda guardado en el teléfono, segundo a segundo");
    expect(grabacion).not.toContain("cifrado");
    const vista = codigo("src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx");
    const glosario = codigo("src/lib/glosario.ts");
    for (const [constante, boton] of [["REANUDAR", "Reanudar"], ["TERMINAR_SESION", "Terminar la sesión"], ["SEGUIR_GRABANDO", "Seguir grabando"]]) {
      expect(glosario).toContain(`export const ${constante} = "${boton}"`);
      expect(vista).toContain(constante);
      expect(grabacion).toContain(`"${boton}"`);
    }
    expect(grabacion).toContain("La recuperación completa no está garantizada");
  });
});
