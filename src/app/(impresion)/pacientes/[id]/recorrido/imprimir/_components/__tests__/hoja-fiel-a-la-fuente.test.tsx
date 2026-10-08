// @vitest-environment jsdom
//
// Contrato: lo que exporta el servidor está en la hoja.
//
// Recorre la exportación de prueba campo por campo. Cada campo es una de dos
// cosas, y nada más:
//
//   COMO_SE_VE              cómo aparece en el HTML de la hoja (texto o
//                           atributo, por ejemplo el <title> de un punto).
//   OMITIDOS_A_PROPOSITO    no se imprime, con el motivo.
//
// Un campo que no está en ninguna de las dos listas hace fallar el test. Así,
// si ExportacionRecorrido gana un campo, el camino es: el fixture no compila
// sin él (fixture-exportacion.ts no tiene cast), y una vez agregado, este
// test pide decidir si la hoja lo muestra o por qué no.
//
// Un campo "sin contenido" (null, "", false, lista vacía, nivel "ninguno")
// no se busca: no hay nada que mostrar. Sí tiene que estar clasificado.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost } from "@/lib/api-client";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { formatearFechaCortaMvd, instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import { fechaCompleta } from "@/lib/format";
import { TENDENCIA_LABEL, ULTIMA_SESION_CON_SENAL } from "@/lib/glosario";

import { dia, diaCorto, diaCortoYHora, diaYHora } from "../formato";
import { RecorridoImprimible } from "../recorrido-imprimible";
import { exportacionDePrueba } from "./fixture-exportacion";

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));

type Valor = string | number | boolean | null;
interface Hoja {
  html: string;
  texto: string;
}
interface Contexto {
  /** El objeto que contiene el campo (la fila, la sesión, el tema…). */
  padre: Record<string, unknown>;
  /** La clave del campo dentro de padre (para flagsRiesgo.* e intervenciones.*). */
  clave: string;
  /** El objeto de la sesión del progreso a la que pertenece, si es de una. */
  sesionProgreso?: Record<string, unknown>;
}
type Muestra = (valor: Valor, hoja: Hoja, ctx: Contexto) => boolean;

const datos = exportacionDePrueba();
const fechaDeSesion = new Map(datos.sesiones.map((s) => [s.id, s.fecha]));

/** Sin tildes ni mayúsculas: las etiquetas de los gráficos se arreglan en
 *  otro lado. Ojo: \p{Diacritic} también borra el punto medio "·". */
const plano = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const contiene = (hoja: Hoja, t: string) => hoja.html.includes(t) || hoja.texto.includes(t);
const diaDelConsultorio = (d: string) => fechaCompleta(instanteDesdeFechaHoraMvd(d, "12:00"));
/** El <title> de cada punto de un gráfico: "20 ago · …". */
const titulosDe = (hoja: Hoja, fecha: string) => {
  const corta = formatearFechaCortaMvd(new Date(fecha));
  return [...hoja.html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]).filter((t) => t.startsWith(`${corta} · `));
};
const enUnPunto = (hoja: Hoja, ctx: Contexto, prueba: (titulo: string) => boolean) =>
  titulosDe(hoja, String(ctx.sesionProgreso?.fecha)).some(prueba);

const texto: Muestra = (v, hoja) => contiene(hoja, String(v));
const entreComillas: Muestra = (v, hoja) => contiene(hoja, `«${v}»`);
/** Todos los párrafos de un texto libre (los separa la línea en blanco). */
const parrafos: Muestra = (v, hoja) => String(v).split(/\n\s*\n/).every((p) => contiene(hoja, p.trim()));
const etiqueta: Muestra = (v, hoja) => contiene(hoja, formatearEtiqueta(String(v)));
const instante: Muestra = (v, hoja) => [diaYHora, diaCortoYHora, dia, diaCorto].some((f) => contiene(hoja, f(String(v))));
const diaDeConsultorio: Muestra = (v, hoja) => contiene(hoja, diaDelConsultorio(String(v)));
const notaDe: Muestra = (v, hoja) => contiene(hoja, `Nota del ${fechaCompleta(new Date(fechaDeSesion.get(String(v)) ?? ""))}`);
const numeroDeVersion: Muestra = (v, hoja) => contiene(hoja, `Versión ${v}`) || contiene(hoja, `>${v}</td>`);

const COMO_SE_VE: Record<string, Muestra> = {
  "paciente.nombre": texto,
  "paciente.apellido": texto,
  nombreProfesional: texto,
  exportadoEn: instante,

  // Las versiones (vigente, anteriores y la fila del historial).
  "version.version": numeroDeVersion,
  "version.actor": (v, hoja) =>
    v === "ia" ? contiene(hoja, "Propuesta de la IA") || contiene(hoja, "propuesta aceptada") : contiene(hoja, "Edición tuya") || contiene(hoja, "revisada por vos"),
  "version.estado": (v, hoja) =>
    ({ aplicada: ["Vigente", "Estuvo vigente", "Aceptada con tus ediciones"], propuesta: ["Sin revisar"], desactualizada: ["Desactualizada"], descartada: ["Descartada"] })[String(v)]?.some((t) => contiene(hoja, t)) ?? false,
  "version.sesionOrigenId": (v, hoja) => contiene(hoja, diaCorto(fechaDeSesion.get(String(v)) ?? "")),
  "version.creadaEn": instante,
  "version.resueltaEn": instante,
  "version.propuestaOrigenId": (_v, hoja) => contiene(hoja, "Aceptada con tus ediciones"),

  // El contenido del Recorrido (HiloContenido).
  "contenido.hipotesisDiagnostica": parrafos,
  "contenido.resumenAcumulativo": parrafos,
  "contenido.objetivosTerapeuticos[].descripcion": texto,
  "contenido.objetivosTerapeuticos[].estado": (v, hoja, { padre }) => contiene(hoja, `${padre.descripcion} · ${v}`),
  "contenido.objetivosTerapeuticos[].fechaInicio": (v, hoja) => contiene(hoja, `Desde ${diaDelConsultorio(String(v))}`),
  "contenido.objetivosTerapeuticos[].fechaCierre": (v, hoja) => contiene(hoja, `Cierre: ${diaDelConsultorio(String(v))}`),
  "contenido.intervencionesProbadas[].tecnica": etiqueta,
  "contenido.intervencionesProbadas[].eficaciaPercibida": (v, hoja) => contiene(hoja, `Eficacia registrada: ${v}`),
  "contenido.intervencionesProbadas[].sesiones[]": notaDe,
  "contenido.temasRecurrentes[].tema": texto,
  "contenido.temasRecurrentes[].conteo": (v, hoja, { padre }) => contiene(hoja, `${padre.tema} · ${v} sesiones`),
  "contenido.riesgosHistoricos[].fecha": diaDeConsultorio,
  "contenido.riesgosHistoricos[].flag": etiqueta,
  "contenido.riesgosHistoricos[].detalle": texto,

  // Las notas aprobadas: su fecha nombra cada sesión en la hoja.
  "sesiones[].fecha": (v, hoja) => contiene(hoja, dia(String(v))) || contiene(hoja, diaCorto(String(v))),

  // El progreso ("Cómo va").
  "progreso.totalSesiones": (v, hoja) => contiene(hoja, `${v} sesiones con nota`) || contiene(hoja, `${v} sesión con nota`),
  "progreso.sesiones[].fecha": (v, hoja) => contiene(hoja, dia(String(v))),
  "progreso.sesiones[].intensidadEmocional": (v, hoja, ctx) => enUnPunto(hoja, ctx, (t) => t.endsWith(` · ${v} de 10`)),
  "progreso.sesiones[].alianzaTerapeutica": (v, hoja, ctx) => enUnPunto(hoja, ctx, (t) => plano(t.split(" · ").at(-1) ?? "") === plano(String(v))),
  "progreso.sesiones[].nivelRiesgo": (v, hoja) => contiene(hoja, `nivel ${v}`) && contiene(hoja, ULTIMA_SESION_CON_SENAL),
  "progreso.sesiones[].flagsRiesgo.*": (_v, hoja, { clave }) => contiene(hoja, formatearEtiqueta(clave)) && contiene(hoja, ULTIMA_SESION_CON_SENAL),
  "progreso.sesiones[].intervenciones.*": (v, hoja, ctx) => enUnPunto(hoja, ctx, (t) => plano(t).includes(`${plano(ctx.clave)} ${v}`)),
  "progreso.sesiones[].observacionIA": entreComillas,
  "progreso.sesiones[].progresoPercibido": entreComillas,
  "progreso.temas[].tema": etiqueta,
  "progreso.temas[].conteo": (v, hoja, { padre }) => contiene(hoja, `${v} de ${padre.deTotal}`),
  "progreso.temas[].deTotal": (v, hoja, { padre }) => contiene(hoja, `${padre.conteo} de ${v}`),
  "progreso.temas[].primeraVez": (v, hoja) => contiene(hoja, `desde ${diaCorto(String(v))}`),
  "progreso.temas[].ultimaVez": (v, hoja) => contiene(hoja, `última vez ${diaCorto(String(v))}`),
  "progreso.temas[].tendencia": (v, hoja) => contiene(hoja, TENDENCIA_LABEL[v as keyof typeof TENDENCIA_LABEL]),
  "progreso.riesgos[].fecha": (v, hoja) => contiene(hoja, dia(String(v))),
  "progreso.riesgos[].flag": etiqueta,
  "progreso.riesgos[].nivel": (v, hoja) => contiene(hoja, `nivel ${v}`),
};

const OMITIDOS_A_PROPOSITO: Record<string, string> = {
  "version.id": "identificador interno: la hoja no muestra ids (recorrido-imprimible.test)",
  "version.basadaEnVersion": "dato de concurrencia de la edición; la secuencia se lee en el número de versión",
  "version.creadaPorUserId": "id de usuaria; quién exporta va con nombre en la cabecera",
  "version.resueltaPorUserId": "id de usuaria, igual que creadaPorUserId",
  "contenido.objetivosTerapeuticos[].id": "identificador interno",
  "contenido.riesgosHistoricos[].sesionId": "identificador; la sesión se nombra por su fecha (riesgosHistoricos[].fecha)",
  "contenido.cambios[]": "la lista de cambios es de una propuesta; en una versión aplicada viene vacía",
  "sesiones[].id": "identificador; sirve para traducir ids a fechas",
  "progreso.pacienteId": "identificador interno",
  "progreso.rango": "exportar.ts pide siempre el período entero (\"todo\")",
  "progreso.sesiones[].sesionId": "identificador; la sesión se nombra por su fecha",
  "progreso.sesiones[].numero": "orden de la sesión; la fecha ya lo dice y la app dejó de rotular S1…Sn",
  "progreso.sesiones[].temas[]": "temas por sesión: la matriz vive detrás de \"Ver detalle\", que no se imprime; el papel lleva el total por tema (progreso.temas)",
  "progreso.riesgos[].sesionId": "identificador; la señal se nombra por su fecha",
  "progreso.riesgos[].cita": "\"Lo que dijo\" va plegado y no se imprime (ayuda 10: En Cómo va no se imprimen las citas)",
};

/** La ruta de cada campo, normalizada: listas como [], las tres formas de
 *  una versión como `version.`, y las claves abiertas de flags e intervenciones como *. */
function normalizar(ruta: string): string {
  return ruta
    .replace(/^(vigente|anteriores\[\]|versiones\[\])\.contenido\./, "contenido.")
    .replace(/^(vigente|anteriores\[\]|versiones\[\])\./, "version.")
    .replace(/(flagsRiesgo|intervenciones)\.[^.]+$/, "$1.*");
}

interface Hallado {
  ruta: string;
  valor: Valor;
  ctx: Contexto;
}

function recorrer(valor: unknown, ruta: string, ctx: Omit<Contexto, "clave">, salida: Hallado[]) {
  if (Array.isArray(valor)) {
    if (valor.length === 0) salida.push({ ruta: `${ruta}[]`, valor: null, ctx: { ...ctx, clave: "" } });
    for (const item of valor) {
      // Una lista de valores sueltos (ids de sesión, temas): cada uno es un campo.
      if (item === null || typeof item !== "object") salida.push({ ruta: `${ruta}[]`, valor: item as Valor, ctx: { ...ctx, clave: "" } });
      else recorrer(item, `${ruta}[]`, ctx, salida);
    }
    return;
  }
  if (valor !== null && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    const sesionProgreso = ruta === "progreso.sesiones[]" ? objeto : ctx.sesionProgreso;
    for (const [clave, hijo] of Object.entries(objeto)) {
      const rutaHija = ruta ? `${ruta}.${clave}` : clave;
      if (hijo === null || typeof hijo !== "object") {
        salida.push({ ruta: rutaHija, valor: hijo as Valor, ctx: { padre: objeto, clave, sesionProgreso } });
      } else {
        recorrer(hijo, rutaHija, { padre: objeto, sesionProgreso }, salida);
      }
    }
  }
}

const sinContenido = (v: Valor) => v === null || v === "" || v === false || v === "ninguno";

const campos: Hallado[] = [];
recorrer(datos, "", { padre: {} }, campos);

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function hoja(): Promise<Hoja> {
  vi.mocked(apiPost).mockResolvedValue(datos);
  const { container } = render(<RecorridoImprimible pacienteId="p" />);
  await screen.findByRole("heading", { level: 1, name: "Ana Pérez" });
  const article = container.querySelector("article")!;
  return { html: article.outerHTML, texto: (article.textContent ?? "").replace(/\s+/g, " ") };
}

describe("la hoja del Recorrido es fiel a la exportación", () => {
  it("recorre la exportación entera", () => {
    expect(campos.length).toBeGreaterThan(80);
    expect(campos.some((c) => c.ruta === "progreso.temas[].ultimaVez")).toBe(true);
  });

  it("cada campo está decidido: se muestra o se omite con motivo, nunca ninguno de los dos", () => {
    const rutas = new Set(campos.map((c) => normalizar(c.ruta)));
    const sinDecidir = [...rutas].filter((r) => !(r in COMO_SE_VE) && !(r in OMITIDOS_A_PROPOSITO));
    expect(sinDecidir, "Campo nuevo en la exportación: mostralo en la hoja y agregalo a COMO_SE_VE, o sumalo a OMITIDOS_A_PROPOSITO con el motivo.").toEqual([]);
    const enLasDos = [...rutas].filter((r) => r in COMO_SE_VE && r in OMITIDOS_A_PROPOSITO);
    expect(enLasDos).toEqual([]);
    for (const [ruta, motivo] of Object.entries(OMITIDOS_A_PROPOSITO)) expect(motivo.length, ruta).toBeGreaterThan(10);
  });

  it("ninguna regla queda muerta: cada entrada nombra un campo que existe", () => {
    const rutas = new Set(campos.map((c) => normalizar(c.ruta)));
    expect([...Object.keys(COMO_SE_VE), ...Object.keys(OMITIDOS_A_PROPOSITO)].filter((r) => !rutas.has(r))).toEqual([]);
  });

  it("cada campo con contenido aparece en el HTML de la hoja", async () => {
    const h = await hoja();
    const faltan = campos
      .filter((c) => !sinContenido(c.valor) && normalizar(c.ruta) in COMO_SE_VE)
      .filter((c) => !COMO_SE_VE[normalizar(c.ruta)](c.valor, h, c.ctx))
      .map((c) => `${c.ruta} = ${JSON.stringify(c.valor)}`);
    expect(faltan).toEqual([]);
  });

  it("el contrato muerde: una hoja sin las lecturas de las sesiones viejas falla", async () => {
    const h = await hoja();
    const sinPrimera = { html: h.html.replaceAll("«Recién empezamos; todavía no duerme bien.»", ""), texto: h.texto.replaceAll("«Recién empezamos; todavía no duerme bien.»", "") };
    const campo = campos.find((c) => c.valor === "Recién empezamos; todavía no duerme bien.")!;
    expect(COMO_SE_VE[normalizar(campo.ruta)](campo.valor, sinPrimera, campo.ctx)).toBe(false);
  });
});
