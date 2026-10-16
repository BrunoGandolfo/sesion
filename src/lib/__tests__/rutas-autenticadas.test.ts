/**
 * Guardianes de todas las rutas de src/app/api, leídas del disco (una ruta
 * nueva entra sola):
 *
 *   1. Todo verbo exportado pide identidad: la sesión de la usuaria, el
 *      secreto de una máquina (cron, worker), el ticket del worker o la firma
 *      de Twilio. Los que son públicos a propósito están en PUBLICAS con su
 *      motivo, y una entrada que ya no corresponde falla.
 *   2. El proxy rechaza un POST/PATCH/DELETE de otro origen, pero sólo en lo
 *      que su matcher deja pasar. Una ruta que el matcher excluye y usa la
 *      sesión de la usuaria en un verbo no seguro tiene que controlar el
 *      origen ella misma (esOrigenPropio, o autorizarEdicionHilo, que lo
 *      hace). El matcher se lee de src/proxy.ts, no se copia acá.
 *
 * multi-tenant.test.ts prueba el aislamiento entre organizaciones de las
 * rutas con id; acá se mira que nadie entre sin decir quién es.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

const RAIZ_API = join(process.cwd(), "src", "app", "api");
const VERBOS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Sesión de la usuaria. buscarActor no lanza (salir sin sesión vale), pero
 *  igual consulta quién es. autorizarEdicionHilo controla el origen y llama
 *  a getSessionActor (src/app/api/_lib/hilo-http.ts). */
const SESION = ["getSessionActor", "getOrganizationId", "buscarActor", "autorizarEdicionHilo"];
/** Máquinas: crons (CRON_SECRET), worker (PROCESSING_SECRET o ticket) y
 *  webhooks firmados de Twilio. */
const MAQUINA = ["requireCron", "requireM2M", "autorizarTicketSesion", "autorizarTicketTrabajo", "firmaValida"];
const CONTROLA_ORIGEN = ["esOrigenPropio", "autorizarEdicionHilo"];

/** Verbos sin identidad, a propósito. La clave es "<ruta> <VERBO>". */
const PUBLICAS: Record<string, string> = {
  "csp-report/route.ts POST": "lo postea el navegador, con o sin sesión; sólo registra el reporte",
  "cuenta/entrar/route.ts POST": "entrar es lo que crea la sesión",
  "cuenta/registro/route.ts POST": "alta de una cuenta nueva",
  "cuenta/recuperar/route.ts POST": "pedir el correo de recuperación sin poder entrar",
  "cuenta/restablecer/route.ts POST": "la identidad es el token del correo de recuperación",
  "estado-worker/route.ts GET": "monitor externo (latido del worker), sin datos de pacientes",
  "health/route.ts GET": "monitor externo, sin datos de pacientes",
  "version/route.ts GET": "constante del build",
};

const llama = (texto: string, nombres: string[]) =>
  nombres.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(texto));

/**
 * Los verbos que exporta un route.ts, cada uno con su texto y el de las
 * funciones del mismo archivo que alcanza (un `autorizar()` local cuenta).
 * Sin comentarios: un `// getSessionActor()` no autentica. Reconoce
 * `export async function GET`, `export const GET = …` y `export { x as GET }`;
 * un verbo reexportado de otro módulo no se puede leer y queda vacío (falla).
 */
function verbosDe(fuenteConComentarios: string): Map<string, string> {
  const fuente = ts
    .createPrinter({ removeComments: true })
    .printFile(ts.createSourceFile("route.ts", fuenteConComentarios, ts.ScriptTarget.Latest, true));
  const sf = ts.createSourceFile("route.ts", fuente, ts.ScriptTarget.Latest, true);
  const locales = new Map<string, ts.Node>();
  const exportados = new Map<string, string | null>();
  const esVerbo = (n: string) => (VERBOS as readonly string[]).includes(n);
  const exportado = (st: ts.Node) =>
    ts.canHaveModifiers(st) && Boolean(ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      locales.set(st.name.text, st);
      if (exportado(st) && esVerbo(st.name.text)) exportados.set(st.name.text, st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        locales.set(d.name.text, d);
        if (exportado(st) && esVerbo(d.name.text)) exportados.set(d.name.text, d.name.text);
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (!esVerbo(el.name.text)) continue;
        exportados.set(el.name.text, st.moduleSpecifier ? null : (el.propertyName ?? el.name).text);
      }
    }
  }

  const textoDe = (inicio: string): string => {
    const vistos = new Set<string>();
    const pendientes = [inicio];
    const partes: string[] = [];
    while (pendientes.length) {
      const nombre = pendientes.pop()!;
      const nodo = locales.get(nombre);
      if (!nodo || vistos.has(nombre)) continue;
      vistos.add(nombre);
      partes.push(nodo.getText(sf));
      const visitar = (n: ts.Node) => {
        if (ts.isIdentifier(n) && locales.has(n.text)) pendientes.push(n.text);
        n.forEachChild(visitar);
      };
      nodo.forEachChild(visitar);
    }
    return partes.join("\n");
  };

  return new Map([...exportados].map(([verbo, local]) => [verbo, local ? textoDe(local) : ""]));
}

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return rutas(ruta);
    return nombre === "route.ts" ? [ruta] : [];
  });
}

/** El path que ve el proxy: cada segmento dinámico con un valor cualquiera. */
const pathDe = (rel: string) => `/api/${rel.replace(/\/?route\.ts$/, "")}`.replace(/\[[^\]]+\]/g, "x1");
const matcher = new RegExp(`^${config.matcher[0]}$`);
const pasaPorElProxy = (rel: string) => matcher.test(pathDe(rel));

const todas = rutas(RAIZ_API)
  .sort()
  .map((abs) => {
    const rel = relative(RAIZ_API, abs).split("\\").join("/");
    return { rel, verbos: verbosDe(readFileSync(abs, "utf8")) };
  });
const pares = todas.flatMap(({ rel, verbos }) => [...verbos].map(([verbo, texto]) => ({ rel, verbo, texto })));

describe("el lector, sobre fuentes de mentira", () => {
  it("ve function, const y alias; sigue a las funciones locales; ignora comentarios", () => {
    const v = verbosDe(`
      async function autorizar() { return getSessionActor(); }
      export async function GET() { await autorizar(); }
      export const POST = async () => { /* getSessionActor() */ return ok(); };
      const borrar = async () => { await requireCron(); };
      export { borrar as DELETE };
      export { PATCH } from "./otra";
    `);
    expect([...v.keys()].sort()).toEqual(["DELETE", "GET", "PATCH", "POST"]);
    expect(llama(v.get("GET")!, SESION)).toBe(true);
    expect(llama(v.get("POST")!, [...SESION, ...MAQUINA])).toBe(false);
    expect(llama(v.get("DELETE")!, MAQUINA)).toBe(true);
    expect(v.get("PATCH")).toBe("");
  });

  it("el matcher del proxy excluye las rutas del worker y deja pasar las de la usuaria", () => {
    expect(pasaPorElProxy("sesion-clinica/[id]/lease/route.ts")).toBe(false);
    expect(pasaPorElProxy("sms/envios/route.ts")).toBe(false);
    expect(pasaPorElProxy("sesion-clinica/[id]/aprobar/route.ts")).toBe(true);
  });
});

describe("toda ruta pide identidad", () => {
  it("encuentra las rutas y sus verbos en el disco", () => {
    expect(todas.length).toBeGreaterThan(60);
    expect(pares.length).toBeGreaterThan(todas.length);
  });

  it("cada entrada de PUBLICAS existe y sigue sin identidad (si no, sacarla)", () => {
    const vigentes = new Map(pares.map((p) => [`${p.rel} ${p.verbo}`, p.texto]));
    for (const clave of Object.keys(PUBLICAS)) {
      expect(vigentes.has(clave), clave).toBe(true);
      expect(llama(vigentes.get(clave)!, [...SESION, ...MAQUINA]), clave).toBe(false);
    }
  });

  it.each(pares.filter((p) => !(`${p.rel} ${p.verbo}` in PUBLICAS)).map((p) => [`${p.rel} ${p.verbo}`, p.texto]))(
    "%s",
    (_clave, texto) => {
      expect(llama(texto, [...SESION, ...MAQUINA])).toBe(true);
    },
  );
});

describe("fuera del proxy, los verbos no seguros con sesión controlan el origen", () => {
  const fuera = pares.filter((p) => !pasaPorElProxy(p.rel));

  it("encuentra rutas fuera del proxy", () => {
    expect(new Set(fuera.map((p) => p.rel)).size).toBeGreaterThanOrEqual(10);
  });

  it.each(
    fuera
      .filter((p) => !SEGUROS.has(p.verbo) && llama(p.texto, SESION))
      .map((p) => [`${p.rel} ${p.verbo}`, p.texto]),
  )("%s", (_clave, texto) => {
    expect(llama(texto, CONTROLA_ORIGEN)).toBe(true);
  });
});
