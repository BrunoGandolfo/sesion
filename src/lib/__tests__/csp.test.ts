// La política de seguridad de contenido y su nonce.
//
// Todo lo que se prueba acá es puro: `construirCsp` arma un string y
// `generarNonce` pide bytes a Web Crypto (que Node 22 trae en globalThis, así
// que no hace falta ningún doble).
//
// Lo que estos casos protegen no es el formato del string: es que nadie
// vuelva a poner `'unsafe-inline'` en `script-src` sin darse cuenta. Ese
// permiso es exactamente lo que necesita un XSS para ejecutarse, y estaba
// puesto antes de este cambio.

import { describe, expect, it } from "vitest";

import {
  cabeceraReportingEndpoints,
  construirCsp,
  generarNonce,
  NOMBRE_ENDPOINT_REPORTE,
  RUTA_REPORTE_CSP,
} from "@/lib/csp";

const NONCE = "abc123abc123abc123abc12=";

/** Los valores de una directiva, como los ve el navegador. */
function directiva(politica: string, nombre: string): string[] {
  const parte = politica
    .split("; ")
    .find((d) => d === nombre || d.startsWith(`${nombre} `));
  if (parte === undefined) return [];
  return parte.slice(nombre.length).trim().split(" ").filter(Boolean);
}

describe("generarNonce", () => {
  it("es base64 válido", () => {
    expect(generarNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("son 128 bits: 16 bytes en base64 son 24 caracteres", () => {
    // La recomendación del W3C es "al menos 128 bits". Si alguien bajara
    // NONCE_BYTES, el nonce se volvería adivinable y la política, decorativa.
    expect(generarNonce()).toHaveLength(24);
  });

  it("no se repite", () => {
    const muchos = new Set(Array.from({ length: 200 }, () => generarNonce()));
    expect(muchos.size).toBe(200);
  });
});

describe("construirCsp — script-src es lo que importa", () => {
  it("lleva el nonce", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).toContain(
      `'nonce-${NONCE}'`,
    );
  });

  it("NO lleva 'unsafe-inline': ése era el agujero", () => {
    // Con 'unsafe-inline' el navegador ignora el nonce por completo y
    // cualquier <script> inyectado corre. Es el motivo entero del cambio.
    expect(directiva(construirCsp(NONCE), "script-src")).not.toContain(
      "'unsafe-inline'",
    );
  });

  it("lleva 'strict-dynamic': los chunks de Next heredan el nonce", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).toContain(
      "'strict-dynamic'",
    );
  });

  it("en producción NO lleva 'unsafe-eval'", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).not.toContain(
      "'unsafe-eval'",
    );
  });

  it("en desarrollo sí, porque React Refresh lo necesita", () => {
    expect(
      directiva(construirCsp(NONCE, { desarrollo: true }), "script-src"),
    ).toContain("'unsafe-eval'");
  });
});

describe("construirCsp — el resto de la política", () => {
  const politica = construirCsp(NONCE);

  it("style-src conserva 'unsafe-inline', y es a propósito", () => {
    // Tailwind v4 y framer-motion escriben en el atributo `style`, que los
    // nonces no cubren. Sacarlo es una pelea aparte (ver AGENTS.md): no
    // bloquea el paso a enforce de script-src, que es lo que frena un XSS.
    expect(directiva(politica, "style-src")).toContain("'unsafe-inline'");
  });

  it("cierra lo que no se usa", () => {
    expect(directiva(politica, "object-src")).toEqual(["'none'"]);
    expect(directiva(politica, "frame-ancestors")).toEqual(["'none'"]);
    expect(directiva(politica, "base-uri")).toEqual(["'self'"]);
    expect(directiva(politica, "form-action")).toEqual(["'self'"]);
  });

  it("deja pasar lo que la grabación necesita", () => {
    // El audio se maneja como blob en el navegador antes de cifrarse.
    expect(directiva(politica, "media-src")).toContain("blob:");
    expect(directiva(politica, "worker-src")).toContain("blob:");
    expect(directiva(politica, "img-src")).toContain("blob:");
  });

  it("Sentry es el único destino externo", () => {
    const connect = directiva(politica, "connect-src");
    expect(connect).toContain("'self'");
    for (const destino of connect) {
      if (destino === "'self'") continue;
      expect(destino).toMatch(/^https:\/\/\*\.ingest\.(us\.|de\.)?sentry\.io$/);
    }
  });

  it("dice a dónde mandar los reportes, por las dos vías", () => {
    // report-uri está deprecado pero es lo que entienden todos los
    // navegadores; report-to es el sucesor. Durante report-only lo que
    // importa es no perder reportes.
    expect(politica).toContain(`report-uri ${RUTA_REPORTE_CSP}`);
    expect(politica).toContain(`report-to ${NOMBRE_ENDPOINT_REPORTE}`);
  });

  it("no repite ninguna directiva", () => {
    // Una directiva repetida no se suma: el navegador se queda con la
    // primera y la segunda se ignora en silencio.
    const nombres = politica.split("; ").map((d) => d.split(" ")[0]);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});

describe("cabeceraReportingEndpoints", () => {
  it("arma la URL absoluta que pide la Reporting API", () => {
    expect(cabeceraReportingEndpoints("https://sesion.uy")).toBe(
      `${NOMBRE_ENDPOINT_REPORTE}="https://sesion.uy${RUTA_REPORTE_CSP}"`,
    );
  });
});
