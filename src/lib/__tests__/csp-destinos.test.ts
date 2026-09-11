// Guardián de los destinos externos: ningún host nuevo sin declarar.
//
// POR QUÉ EXISTE
//
// La CSP se escribió con Sentry como único destino de connect-src, y el
// navegador ya subía el audio con un PUT directo a R2. Nadie lo vio porque
// nada relacionaba "los hosts que el código usa" con "los hosts que la
// política permite". En report-only sólo eran reportes en un log que nadie
// leía; en enforce habría sido la subida de toda grabación, rota.
//
// Este test hace esa relación a mano: recorre src/** buscando literales
// `https://…` y exige que cada host esté declarado en uno de tres lugares:
//
//   - DESTINOS_EXTERNOS (src/lib/csp.ts): el navegador le habla → connect-src;
//   - SERVIDOR_A_SERVIDOR (acá abajo): sólo el servidor le habla, y por eso
//     NO va en la CSP. Cada entrada dice qué archivo lo usa;
//   - PROPIOS_O_NAVEGACION (acá abajo): el propio dominio, o un enlace `<a
//     href>` que abre otra pestaña (eso no es connect-src).
//
// Un host que no esté en ninguna lista falla con la instrucción de dónde
// declararlo. Es lo mismo que hace middleware-edge.test.ts con los imports:
// una convención que se verifica sola.
//
// LÍMITES (dichos a propósito)
//
//   - Lee literales con expresiones regulares, no con un AST. Un host armado
//     en una variable se le escapa: R2 es exactamente ese caso
//     (`https://${accountId}.r2.cloudflarestorage.com` en src/lib/r2.ts), y
//     por eso se verifica aparte, por su sufijo.
//   - No distingue solo si un archivo corre en el navegador o en el servidor:
//     por eso las listas de abajo son explícitas y cada entrada lleva quién
//     la usa.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { construirDestinos, hostsExternos, SUFIJO_HOST_R2, validarHostR2 } from "@/lib/csp";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");

/** Hosts a los que sólo habla el SERVIDOR. No van en la CSP. */
const SERVIDOR_A_SERVIDOR: Record<string, string> = {
  "api.resend.com": "correo transaccional y alertas (src/lib/correo.ts)",
  "api.twilio.com": "SMS (src/lib/sms/twilio.ts)",
  "api.anthropic.com": "ayuda y análisis clínico (src/lib/anthropic-mensajes.ts)",
};

/** El propio dominio y enlaces de navegación (no son connect-src). */
const PROPIOS_O_NAVEGACION: Record<string, string> = {
  "sesionapp.app": "origen de la app (enlaces de cuenta, src/lib/cuenta-tokens.ts)",
  "wa.me": "enlace <a href> para compartir una invitación por WhatsApp (abre otra pestaña)",
};

/** Un host declarado en DESTINOS_EXTERNOS: comodín `*.` al principio, o exacto. */
function coincideConDestino(host: string, patron: string): boolean {
  const patronHost = patron.replace(/^https:\/\//, "");
  if (patronHost.startsWith("*.")) {
    return host.endsWith(patronHost.slice(1)) && host !== patronHost.slice(2);
  }
  return host === patronHost;
}

function archivosDeSrc(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__") continue;
      out.push(...archivosDeSrc(ruta));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

/** Quita las líneas que son solo comentario (URLs de documentación). */
function sinComentarios(fuente: string): string {
  return fuente
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const LITERAL = /https:\/\/([a-zA-Z0-9*][a-zA-Z0-9.*-]*)/g;

interface Hallazgo {
  host: string;
  archivo: string;
}

function hostsEnSrc(): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const archivo of archivosDeSrc(SRC)) {
    const fuente = sinComentarios(readFileSync(archivo, "utf8"));
    for (const m of fuente.matchAll(LITERAL)) {
      out.push({ host: m[1], archivo: relative(RAIZ, archivo) });
    }
  }
  return out;
}

const DESTINOS = hostsExternos(
  construirDestinos({ R2_PUBLIC_HOST: `https://cuenta${SUFIJO_HOST_R2}` }),
);

describe("destinos externos del código", () => {
  it("todo host https:// de src/** está declarado en algún lado", () => {
    const sinDeclarar = hostsEnSrc().filter(({ host }) => {
      if (DESTINOS.some((p) => coincideConDestino(host, p))) return false;
      if (host in SERVIDOR_A_SERVIDOR) return false;
      if (host in PROPIOS_O_NAVEGACION) return false;
      return true;
    });

    const detalle = sinDeclarar.map(
      (h) =>
        `${h.archivo}: ${h.host} — si el NAVEGADOR le habla va en DESTINOS_EXTERNOS ` +
        "(src/lib/csp.ts); si sólo el servidor, en SERVIDOR_A_SERVIDOR de este test.",
    );
    expect(detalle).toEqual([]);
  });

  it("el guardián de verdad encuentra los hosts que sabemos que están", () => {
    // Si dejara de encontrar nada, pasaría en verde sin haber mirado.
    const hosts = new Set(hostsEnSrc().map((h) => h.host));
    expect(hosts).toContain("api.resend.com");
    expect(hosts).toContain("*.ingest.sentry.io");
  });

  it("el origen de la URL prefirmada de R2 es el que R2_PUBLIC_HOST tiene que declarar", async () => {
    // La forma no es obvia: el SDK de S3 firma en estilo virtual-hosted y
    // el bucket va como primer subdominio. Se genera una URL de verdad (con
    // credenciales falsas: firmar no habla con la red) y se compara con lo
    // que documentan .env.example y csp.ts. Si Cloudflare o el SDK cambian
    // la forma, este caso lo dice antes que el log de reportes.
    process.env.R2_ACCOUNT_ID = "0123456789abcdef";
    process.env.R2_ACCESS_KEY_ID = "AKIAFALSA";
    process.env.R2_SECRET_ACCESS_KEY = "falsa";
    process.env.R2_BUCKET_NAME = "sesion-audio";
    const { generarUrlSubida } = await import("@/lib/r2");
    const { url } = await generarUrlSubida("org/sesion/0", {
      contentType: "application/octet-stream",
      contentLength: 10,
    });
    const origen = new URL(url).origin;

    expect(origen).toBe(`https://sesion-audio.0123456789abcdef${SUFIJO_HOST_R2}`);
    expect(validarHostR2(origen)).toBe(origen);

    const ejemplo = readFileSync(join(RAIZ, ".env.example"), "utf8");
    const declarado = ejemplo.match(/^R2_PUBLIC_HOST="([^"]+)"/m)?.[1] ?? "";
    expect(declarado.startsWith("https://sesion-audio.")).toBe(true);
    expect(declarado.endsWith(SUFIJO_HOST_R2)).toBe(true);
  });

  it("R2 se arma en una variable: se verifica por el sufijo del endpoint", () => {
    // src/lib/r2.ts construye `https://${accountId}.r2.cloudflarestorage.com`
    // y ese es el host al que el navegador hace PUT. La CSP lo declara por
    // R2_PUBLIC_HOST con el mismo sufijo: si alguien cambia el endpoint (un
    // dominio propio de R2, por ejemplo), este caso lo dice.
    const r2 = readFileSync(join(SRC, "lib", "r2.ts"), "utf8");
    expect(r2).toContain(SUFIJO_HOST_R2);
    expect(DESTINOS.some((h) => h.endsWith(SUFIJO_HOST_R2))).toBe(true);
  });

  it("las listas de este test no repiten lo que ya está en DESTINOS_EXTERNOS", () => {
    for (const host of [...Object.keys(SERVIDOR_A_SERVIDOR), ...Object.keys(PROPIOS_O_NAVEGACION)]) {
      expect(DESTINOS.some((p) => coincideConDestino(host, p))).toBe(false);
    }
  });
});
