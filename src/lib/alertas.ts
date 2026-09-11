// Única salida de alertas del sistema: un correo a la casilla del dueño.
//
// Decisión del dueño (11-09-2026): el canal es el CORREO, uno solo, por
// Resend, que ya está configurado para los correos de cuenta. Antes las
// alertas iban a un webhook opcional y, si no estaba, a console.warn — un
// archivo de registro que nadie abre. Ahora:
//
//   - `alertar()` manda el correo a ALERTA_CORREO con RESEND_API_KEY;
//   - reintenta dos veces con espera (el proveedor puede fallar un segundo);
//   - si igual no sale, lo escribe en el log Y lo manda a Sentry con
//     captureMessage. Dos canales independientes; que los dos caigan a la vez
//     es un riesgo aceptado y dicho.
//   - NUNCA lanza: una alerta que no se pudo mandar no puede tumbar el cron
//     que la estaba mandando.
//
// `detalle` nunca lleva texto clínico ni teléfonos: pasa por detalleSeguro
// (la misma lista negra de la auditoría) antes de entrar al correo.
//
// Sólo la importan rutas Node (crons, health): auditoria-pura usa
// node:crypto y correo.ts habla con Resend. Nunca desde el middleware.

import * as Sentry from "@sentry/nextjs";

import { detalleSeguro } from "@/app/api/_lib/auditoria-pura";
import { enviarCorreo } from "@/lib/correo";
import type { NivelAlerta } from "@/lib/salud-metricas";

export type { NivelAlerta };

/** Cuántas veces se intenta mandar el correo antes de caer a Sentry. */
export const INTENTOS_ALERTA = 3;

/** Espera entre intentos, en ms: 0.5 s y después 2 s. */
export const ESPERAS_MS: readonly number[] = [500, 2000];

export type DetalleAlerta = Record<string, string | number | boolean | null>;

export interface OpcionesAlerta {
  /** Para tests: el fetch que usa el correo. */
  fetcher?: typeof fetch;
  /** Para tests: no esperar entre reintentos. */
  esperar?: (ms: number) => Promise<void>;
  ahora?: Date;
  /** Para tests: dónde leer ALERTA_CORREO y RESEND_API_KEY. */
  env?: Record<string, string | undefined>;
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Asunto y cuerpo del correo. Pura, para poder mirarla en un test. */
export function armarAlerta(
  nivel: NivelAlerta,
  titulo: string,
  detalle: DetalleAlerta | undefined,
  ahora: Date,
): { asunto: string; texto: string; html: string } {
  const etiqueta = nivel === "critico" ? "CRÍTICO" : "Aviso";
  const asunto = `[Sesión] ${etiqueta}: ${titulo}`;
  const seguro = detalleSeguro(detalle) ?? {};
  const lineas = [
    titulo,
    "",
    ...Object.entries(seguro).map(([k, v]) => `${k}: ${String(v)}`),
    "",
    `Nivel: ${etiqueta}`,
    `Cuándo: ${ahora.toISOString()}`,
    "Origen: cron de salud / operación de Sesión",
  ];
  const texto = lineas.join("\n");
  return { asunto, texto, html: `<pre>${escaparHtml(texto)}</pre>` };
}

function aSentry(nivel: NivelAlerta, asunto: string, motivo: string): void {
  try {
    if (Sentry.getClient()) {
      Sentry.captureMessage(`${asunto} — ${motivo}`, nivel === "critico" ? "fatal" : "warning");
    }
  } catch {
    // Un fallo del propio SDK no puede tumbar a quien alerta.
  }
}

/**
 * Manda la alerta. Devuelve true si el correo salió; false si no (y en ese
 * caso ya quedó en el log y en Sentry). No lanza nunca.
 */
export async function alertar(
  nivel: NivelAlerta,
  titulo: string,
  detalle?: DetalleAlerta,
  opciones: OpcionesAlerta = {},
): Promise<boolean> {
  const env = opciones.env ?? process.env;
  const ahora = opciones.ahora ?? new Date();
  const esperar = opciones.esperar ?? dormir;
  const { asunto, texto, html } = armarAlerta(nivel, titulo, detalle, ahora);

  const para = env.ALERTA_CORREO?.trim();
  if (!para) {
    console.error(`[alertas] falta ALERTA_CORREO: no se pudo mandar "${asunto}"`);
    console.error(`[alertas] ${texto.replaceAll("\n", " | ")}`);
    aSentry(nivel, asunto, "falta ALERTA_CORREO");
    return false;
  }

  let ultimo = "";
  for (let intento = 0; intento < INTENTOS_ALERTA; intento += 1) {
    try {
      await enviarCorreo(
        { para, asunto, texto, html },
        { apiKey: env.RESEND_API_KEY, fetcher: opciones.fetcher },
      );
      return true;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
      const espera = ESPERAS_MS[intento];
      if (espera !== undefined) await esperar(espera);
    }
  }

  console.error(`[alertas] el correo no salió tras ${INTENTOS_ALERTA} intentos (${ultimo}): "${asunto}"`);
  console.error(`[alertas] ${texto.replaceAll("\n", " | ")}`);
  aSentry(nivel, asunto, ultimo);
  return false;
}
