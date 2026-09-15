import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCUMENTOS = ["README.md", "docs/pipeline.md", "docs/encryption.md", "docs/operaciones.md"];
const RUTA = /^(?:(?:src|docs|prisma|processor|scripts|\.github)\/|\.env(?:\.|$)|(?:README|AGENTS)\.md$|(?:package(?:-lock)?|vercel)\.json$|[\w.-]+\.(?:tsx?|jsx?|mjs|yml|yaml)$)/;
const VARIABLE = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;

/** Sólo lee referencias: nunca valores de .env ni recursos externos. */
export function revisarTexto(texto, { existe, leer, variables }) {
  const errores = [];
  const rutas = new Set();
  const entorno = new Set();
  const http = new Set();
  for (const [, codigo] of texto.matchAll(/\x60([^\x60\n]+)\x60/g)) {
    if (VARIABLE.test(codigo)) entorno.add(codigo);
    else if (RUTA.test(codigo) && !/\s/.test(codigo)) rutas.add(codigo);
    const solicitud = codigo.match(/^(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS) (\/api\/[^ ?]+)(?:\?[^ ]*)?$/);
    if (solicitud) http.add(solicitud[1] + " " + solicitud[2]);
  }
  // Enlaces locales convencionales. Los documentos usan rutas de archivo desde la raíz.
  for (const [, enlace] of texto.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!/^(?:https?:|#)/.test(enlace)) rutas.add(enlace.split("#")[0]);
  }
  for (const ruta of rutas) if (!existe(ruta)) errores.push("No existe: " + ruta);
  for (const nombre of entorno) if (!variables.has(nombre)) errores.push("Falta en .env.example: " + nombre);
  for (const solicitud of http) {
    const [metodo, ruta] = solicitud.split(" ");
    const archivo = "src/app" + ruta + "/route.ts";
    if (!existe(archivo)) {
      errores.push("Ruta HTTP ausente: " + solicitud);
    } else if (!new RegExp("\\bexport\\s+(?:async\\s+)?(?:function\\s+" + metodo + "\\b|const\\s+" + metodo + "\\b)").test(leer(archivo))) {
      errores.push("Método HTTP ausente: " + solicitud);
    }
  }
  return { errores, rutas: rutas.size, variables: entorno.size, http: http.size };
}

export function verificarDocumentacion(raiz = process.cwd()) {
  const leer = ruta => readFileSync(resolve(raiz, ruta), "utf8");
  const variables = new Set([...leer(".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
  const resultados = DOCUMENTOS.map(archivo => ({
    archivo,
    ...revisarTexto(leer(archivo), { leer, existe: ruta => existsSync(resolve(raiz, ruta)), variables }),
  }));
  return resultados;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resultados = verificarDocumentacion();
  const errores = resultados.flatMap(r => r.errores.map(error => r.archivo + ": " + error));
  if (errores.length) {
    console.error(errores.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Documentación vigente:", JSON.stringify(resultados));
  }
}
