// Cómo se lee una violación de CSP y cómo queda en el log.
//
// Está acá y no adentro de src/app/api/csp-report/route.ts por la misma
// razón que el caso de uso del cron de salud: un archivo de ruta de Next no
// puede exportar nada más que el handler y su configuración, así que nada de
// lo que hay adentro se puede mirar desde un test.
//
// QUÉ SE LOGUEA Y QUÉ NO
//
// Campos concretos, no el cuerpo entero. Una URL de esta app puede llevar el
// id de una paciente en el path, y el reporte trae hasta 40 caracteres del
// script ofensor (`script-sample`), que en una app clínica podrían ser
// cualquier cosa. Se recorta todo y no se copia lo que no se nombró.

/** Cuánto se conserva de cada campo de texto. */
export const MAX_CAMPO = 300;

/** Cuántos reportes se loguean de un mismo POST (la Reporting API agrupa). */
export const MAX_POR_POST = 10;

/** La forma vieja: Content-Type application/csp-report. */
interface ReporteClasico {
  "document-uri"?: unknown;
  "violated-directive"?: unknown;
  "effective-directive"?: unknown;
  "blocked-uri"?: unknown;
  "source-file"?: unknown;
  "line-number"?: unknown;
  disposition?: unknown;
}

/** La forma nueva: Content-Type application/reports+json. */
interface ReporteModerno {
  documentURL?: unknown;
  effectiveDirective?: unknown;
  blockedURL?: unknown;
  sourceFile?: unknown;
  lineNumber?: unknown;
  disposition?: unknown;
}

/** Lo que termina en el log, ya normalizado y recortado. */
export interface Violacion {
  documento: string;
  directiva: string;
  bloqueado: string;
  archivo: string;
  linea: string;
  disposicion: string;
}

/**
 * Caracteres que no pueden llegar al log tal cual: los de control C0/C1 y
 * los separadores de línea de Unicode. Un salto de línea adentro de un campo
 * parte la línea en dos y, como el formato es una línea por violación,
 * cualquiera podría postear un reporte falso ADENTRO de otro.
 */
const CONTROLES = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Recortado y sin caracteres de control. El endpoint es público: todo lo
 *  que sale de acá lo escribió alguien de afuera. */
function texto(valor: unknown): string {
  if (typeof valor === "string") {
    const recortado =
      valor.length > MAX_CAMPO ? `${valor.slice(0, MAX_CAMPO)}…` : valor;
    // Espacio y no vacío: recortar cambiaría la longitud y taparía que el
    // campo venía con basura.
    return recortado.replace(CONTROLES, " ");
  }
  if (typeof valor === "number" || typeof valor === "boolean") {
    return String(valor);
  }
  return "";
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Normaliza los dos formatos a uno solo.
 *
 * `application/csp-report` manda `{ "csp-report": { … } }` con claves en
 * kebab-case; `application/reports+json` manda un array de
 * `{ type, body: { … } }` con claves en camelCase. Los dos describen lo
 * mismo, ningún navegador garantiza cuál usa, y hay que aceptar los dos.
 *
 * Con cualquier otra cosa devuelve una lista vacía: un POST con basura a un
 * endpoint público no es un error, es internet.
 */
export function normalizarReportes(cuerpo: unknown): Violacion[] {
  const crudos: unknown[] = [];

  if (Array.isArray(cuerpo)) {
    for (const entrada of cuerpo) {
      if (!esObjeto(entrada)) continue;
      // El array de la Reporting API puede traer reportes de otros tipos
      // (deprecation, intervention): sólo interesan los de CSP.
      if (entrada.type !== undefined && entrada.type !== "csp-violation") {
        continue;
      }
      crudos.push(esObjeto(entrada.body) ? entrada.body : entrada);
    }
  } else if (esObjeto(cuerpo)) {
    crudos.push(esObjeto(cuerpo["csp-report"]) ? cuerpo["csp-report"] : cuerpo);
  }

  return crudos.slice(0, MAX_POR_POST).map((crudo) => {
    const c = crudo as ReporteClasico & ReporteModerno;
    return {
      documento: texto(c.documentURL ?? c["document-uri"]),
      directiva: texto(
        c.effectiveDirective ??
          c["effective-directive"] ??
          c["violated-directive"],
      ),
      bloqueado: texto(c.blockedURL ?? c["blocked-uri"]),
      archivo: texto(c.sourceFile ?? c["source-file"]),
      linea: texto(c.lineNumber ?? c["line-number"]),
      disposicion: texto(c.disposition),
    };
  });
}

/**
 * Escapa lo que rompería el formato `clave="valor"`. Los caracteres de
 * control ya los sacó `texto()` al normalizar; acá se cierran las comillas y
 * la barra, que son cosa del formateo y no del dato.
 */
function entreComillas(valor: string): string {
  return valor.replace(/[\\"]/g, "\\$&");
}

/** Una línea por violación, greppable. */
export function formatearViolacion(v: Violacion): string {
  const c = entreComillas;
  return (
    `[csp] directiva="${c(v.directiva)}" bloqueado="${c(v.bloqueado)}" ` +
    `documento="${c(v.documento)}" archivo="${c(v.archivo)}:${c(v.linea)}" ` +
    `disposicion="${c(v.disposicion)}"`
  );
}
