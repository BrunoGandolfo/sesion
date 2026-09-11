// La política de seguridad de contenido y su nonce.
//
// Todo lo que se prueba acá es puro: `construirCsp` arma un string y
// `generarNonce` pide bytes a Web Crypto (que Node 22 trae en globalThis, así
// que no hace falta ningún doble).
//
// Lo que estos casos protegen no es el formato del string: es que nadie
// vuelva a poner `'unsafe-inline'` en `script-src` sin darse cuenta, y que
// `connect-src` diga EXACTAMENTE los destinos declarados en
// DESTINOS_EXTERNOS: ni uno más (política ancha) ni uno menos (el día del
// enforce se rompe la subida del audio, que es lo que pasó con R2).

import { describe, expect, it } from "vitest";

import {
  cabeceraReportingEndpoints,
  construirCsp,
  construirDestinos,
  generarNonce,
  hostsExternos,
  NOMBRE_ENDPOINT_REPORTE,
  RUTA_REPORTE_CSP,
  validarHostR2,
} from "@/lib/csp";

const NONCE = "abc123abc123abc123abc12=";
const R2 = "https://sesion-audio.0123456789abcdef.r2.cloudflarestorage.com";
const DESTINOS = construirDestinos({ R2_PUBLIC_HOST: R2 });

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
    expect(generarNonce()).toHaveLength(24);
  });

  it("no se repite", () => {
    const muchos = new Set(Array.from({ length: 200 }, () => generarNonce()));
    expect(muchos.size).toBe(200);
  });
});

describe("construirCsp — script-src es lo que importa", () => {
  it("lleva el nonce", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).toContain(`'nonce-${NONCE}'`);
  });

  it("NO lleva 'unsafe-inline': ése era el agujero", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("lleva 'strict-dynamic': los chunks de Next heredan el nonce", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).toContain("'strict-dynamic'");
  });

  it("en producción NO lleva 'unsafe-eval'", () => {
    expect(directiva(construirCsp(NONCE), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("en desarrollo sí, porque React Refresh lo necesita", () => {
    expect(directiva(construirCsp(NONCE, { desarrollo: true }), "script-src")).toContain("'unsafe-eval'");
  });
});

describe("construirCsp — connect-src son los destinos declarados, exactamente", () => {
  it("contiene 'self' y todos los hosts de DESTINOS_EXTERNOS, y ningún otro", () => {
    const connect = directiva(construirCsp(NONCE, { destinos: DESTINOS }), "connect-src");
    expect(connect[0]).toBe("'self'");
    expect(connect.slice(1)).toEqual(hostsExternos(DESTINOS));
  });

  it("R2 está, como host exacto, cuando R2_PUBLIC_HOST está cargada", () => {
    // El navegador hace PUT del audio cifrado directo a R2: sin esto, el día
    // del enforce no se sube ninguna grabación.
    const connect = directiva(construirCsp(NONCE, { destinos: DESTINOS }), "connect-src");
    expect(connect).toContain(R2);
    expect(connect.some((h) => h.includes("*.r2."))).toBe(false);
  });

  it("sin R2_PUBLIC_HOST, R2 queda afuera (y el validador de entorno lo reclama)", () => {
    const sinR2 = construirDestinos({});
    expect(sinR2.r2).toEqual([]);
    const connect = directiva(construirCsp(NONCE, { destinos: sinR2 }), "connect-src");
    expect(connect.some((h) => h.includes("cloudflarestorage"))).toBe(false);
  });

  it("Sentry sigue estando, en sus tres regiones", () => {
    const connect = directiva(construirCsp(NONCE, { destinos: DESTINOS }), "connect-src");
    for (const region of ["", "us.", "de."]) {
      expect(connect).toContain(`https://*.ingest.${region}sentry.io`);
    }
  });
});

describe("validarHostR2", () => {
  it("acepta el origen exacto de un bucket de una cuenta", () => {
    expect(validarHostR2(R2)).toBe(R2);
    expect(validarHostR2(`${R2}/`)).toBe(R2);
    expect(validarHostR2(`  ${R2}  `)).toBe(R2);
  });

  it("rechaza comodines: abrirían la política a cualquier cuenta de R2", () => {
    expect(validarHostR2("https://*.r2.cloudflarestorage.com")).toBeNull();
  });

  it("rechaza lo que no es un host de R2 por https", () => {
    expect(validarHostR2("http://0123.r2.cloudflarestorage.com")).toBeNull();
    expect(validarHostR2("https://r2.cloudflarestorage.com")).toBeNull();
    expect(validarHostR2("https://evil.example.com")).toBeNull();
    expect(validarHostR2("0123.r2.cloudflarestorage.com")).toBeNull();
    expect(validarHostR2("https://0123.r2.cloudflarestorage.com/bucket")).toBeNull();
    expect(validarHostR2("https://0123.r2.cloudflarestorage.com:8443")).toBeNull();
    expect(validarHostR2("")).toBeNull();
    expect(validarHostR2(undefined)).toBeNull();
  });
});

describe("construirCsp — el resto de la política", () => {
  const politica = construirCsp(NONCE, { destinos: DESTINOS });

  it("style-src conserva 'unsafe-inline', y es a propósito", () => {
    expect(directiva(politica, "style-src")).toContain("'unsafe-inline'");
  });

  it("cierra lo que no se usa", () => {
    expect(directiva(politica, "object-src")).toEqual(["'none'"]);
    expect(directiva(politica, "frame-ancestors")).toEqual(["'none'"]);
    expect(directiva(politica, "base-uri")).toEqual(["'self'"]);
    expect(directiva(politica, "form-action")).toEqual(["'self'"]);
  });

  it("deja pasar lo que la grabación necesita", () => {
    expect(directiva(politica, "media-src")).toContain("blob:");
    expect(directiva(politica, "worker-src")).toContain("blob:");
    expect(directiva(politica, "img-src")).toContain("blob:");
  });

  it("dice a dónde mandar los reportes, por las dos vías", () => {
    expect(politica).toContain(`report-uri ${RUTA_REPORTE_CSP}`);
    expect(politica).toContain(`report-to ${NOMBRE_ENDPOINT_REPORTE}`);
  });

  it("no repite ninguna directiva", () => {
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
