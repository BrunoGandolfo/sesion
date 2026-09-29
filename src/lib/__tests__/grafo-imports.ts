// Helper de test: el grafo de imports locales de src/, leído con el parser de
// TypeScript (no con regex sobre el texto). Lo usan los guardianes que
// preguntan "¿quién alcanza X?": una ruta que llega a un módulo por un caso
// de uso, un re-export o un import() dinámico cuenta igual que una que lo
// importa directo.
//
// Todo cuelga de una raíz (por defecto, el repo) para que un test pueda
// armar un árbol de mentira en un directorio temporal y probar el detector.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

const EXTENSIONES = [".ts", ".tsx", ".mts", ".js", ".jsx"];

/** Un import, re-export o import() dinámico de un archivo local. */
export interface ImportLocal {
  tipo: "import" | "reexport";
  /** Ruta relativa a la raíz del módulo importado. */
  destino: string;
  /** Los nombres ORIGINALES que trae; "*" si trae el módulo entero
   *  (namespace, `export *` o import() dinámico). */
  nombres: string[] | "*";
  /** En un re-export con nombres, el nombre con que sale de este módulo
   *  (mismo orden que `nombres`). */
  alias?: string[];
  /** `export * as x from "…"`: el módulo entero sale con el nombre `x`. */
  comoNamespace?: string;
}

export interface Grafo {
  raiz: string;
  leer(archivo: string): string;
  importsLocales(archivo: string): ImportLocal[];
  /** Todo lo que alcanza `entrada`, con la cadena por la que llegó. No se
   *  entra a los módulos de `hasta`. */
  alcanzables(entrada: string, hasta?: ReadonlySet<string>): Map<string, string[]>;
  /** Todos los .ts/.tsx bajo `dir` (relativo a la raíz). */
  archivosBajo(dir: string): string[];
  /** Los `route.ts` bajo `dir`. */
  rutasBajo(dir: string): string[];
}

function esArchivo(ruta: string): boolean {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
}

export function crearGrafo(raiz: string = process.cwd()): Grafo {
  const src = resolve(raiz, "src");
  const cache = new Map<string, ImportLocal[]>();
  const leer = (archivo: string) => readFileSync(resolve(raiz, archivo), "utf8");

  function resolverLocal(desde: string, especificador: string): string | null {
    let base: string;
    if (especificador.startsWith("@/")) base = join(src, especificador.slice(2));
    else if (especificador.startsWith(".")) base = resolve(dirname(desde), especificador);
    else return null;
    for (const ext of EXTENSIONES) if (esArchivo(base + ext)) return base + ext;
    for (const ext of EXTENSIONES) {
      const indice = join(base, `index${ext}`);
      if (esArchivo(indice)) return indice;
    }
    return esArchivo(base) ? base : null;
  }

  function importsLocales(archivo: string): ImportLocal[] {
    const guardado = cache.get(archivo);
    if (guardado) return guardado;
    const absoluto = resolve(raiz, archivo);
    const fuente = ts.createSourceFile(absoluto, leer(archivo), ts.ScriptTarget.Latest, true);
    const salida: ImportLocal[] = [];
    const agregar = (especificador: string, dato: Omit<ImportLocal, "destino">) => {
      const destino = resolverLocal(absoluto, especificador);
      if (destino) salida.push({ ...dato, destino: relative(raiz, destino) });
    };
    const visitar = (nodo: ts.Node) => {
      if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)) {
        const clausula = nodo.importClause;
        const enlaces = clausula?.namedBindings;
        if (!clausula) agregar(nodo.moduleSpecifier.text, { tipo: "import", nombres: [] });
        else if (enlaces && ts.isNamespaceImport(enlaces)) agregar(nodo.moduleSpecifier.text, { tipo: "import", nombres: "*" });
        else {
          const nombres = enlaces && ts.isNamedImports(enlaces) ? enlaces.elements.map((e) => (e.propertyName ?? e.name).text) : [];
          if (clausula.name) nombres.push("default");
          agregar(nodo.moduleSpecifier.text, { tipo: "import", nombres });
        }
      } else if (ts.isExportDeclaration(nodo) && nodo.moduleSpecifier && ts.isStringLiteral(nodo.moduleSpecifier)) {
        const clausula = nodo.exportClause;
        if (clausula && ts.isNamedExports(clausula)) {
          agregar(nodo.moduleSpecifier.text, {
            tipo: "reexport",
            nombres: clausula.elements.map((e) => (e.propertyName ?? e.name).text),
            alias: clausula.elements.map((e) => e.name.text),
          });
        } else if (clausula && ts.isNamespaceExport(clausula)) {
          agregar(nodo.moduleSpecifier.text, { tipo: "reexport", nombres: "*", comoNamespace: clausula.name.text });
        } else {
          agregar(nodo.moduleSpecifier.text, { tipo: "reexport", nombres: "*" });
        }
      } else if (
        ts.isCallExpression(nodo) &&
        nodo.expression.kind === ts.SyntaxKind.ImportKeyword &&
        nodo.arguments.length > 0 &&
        ts.isStringLiteralLike(nodo.arguments[0])
      ) {
        agregar(nodo.arguments[0].text, { tipo: "import", nombres: "*" });
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    cache.set(archivo, salida);
    return salida;
  }

  function alcanzables(entrada: string, hasta: ReadonlySet<string> = new Set()): Map<string, string[]> {
    const vistos = new Map<string, string[]>([[entrada, [entrada]]]);
    const pendientes = [entrada];
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      if (hasta.has(actual) && actual !== entrada) continue;
      for (const { destino } of importsLocales(actual)) {
        if (vistos.has(destino)) continue;
        vistos.set(destino, [...vistos.get(actual)!, destino]);
        pendientes.push(destino);
      }
    }
    return vistos;
  }

  function archivosBajo(dir: string): string[] {
    return ts.sys
      .readDirectory(resolve(raiz, dir), [".ts", ".tsx"], ["**/node_modules/**"])
      .map((a) => relative(raiz, a))
      .sort();
  }

  function rutasBajo(dir: string): string[] {
    return archivosBajo(dir).filter((a) => a.endsWith("/route.ts"));
  }

  return { raiz, leer, importsLocales, alcanzables, archivosBajo, rutasBajo };
}

/**
 * Qué nombres exporta cada módulo que vengan de `origen`, siguiendo
 * re-exports (`export *`, `export { x as y }`) hasta que no cambie nada.
 * `nombresDeOrigen` son los exports de `origen` que interesan.
 */
export function exportadoresDe(grafo: Grafo, origen: string, nombresDeOrigen: ReadonlySet<string>): Map<string, Set<string>> {
  const exporta = new Map<string, Set<string>>([[origen, new Set(nombresDeOrigen)]]);
  const todos = grafo.archivosBajo("src");
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const modulo of todos) {
      for (const imp of grafo.importsLocales(modulo)) {
        if (imp.tipo !== "reexport") continue;
        const delDestino = exporta.get(imp.destino);
        if (!delDestino || delDestino.size === 0) continue;
        // `export * as x`: lo que interesa viaja dentro de `x`.
        const nuevos = imp.comoNamespace
          ? [imp.comoNamespace]
          : imp.nombres === "*"
            ? [...delDestino]
            : imp.nombres.flatMap((n, i) => (delDestino.has(n) ? [imp.alias![i]] : []));
        const propios = exporta.get(modulo) ?? new Set<string>();
        for (const n of nuevos) {
          if (!propios.has(n)) {
            propios.add(n);
            cambio = true;
          }
        }
        if (propios.size > 0) exporta.set(modulo, propios);
      }
    }
  }
  return exporta;
}
