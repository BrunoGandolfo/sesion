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

function texto(valor: unknown): string {
  if (typeof valor === "string") {
    return valor.length > MAX_CAMPO ? `${valor.slice(0, MAX_CAMPO)}…` : valor;
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

/** Una línea por violación, greppable. */
export function formatearViolacion(v: Violacion): string {
  return (
    `[csp] directiva="${v.directiva}" bloqueado="${v.bloqueado}" ` +
    `documento="${v.documento}" archivo="${v.archivo}:${v.linea}" ` +
    `disposicion="${v.disposicion}"`
  );
}
