// Variables de entorno sin las cuales la operación no funciona.
//
// Antes, faltar una de éstas se descubría el día que hacía falta: sin
// ALERTA_WEBHOOK_URL el cron de salud escribía en un log que nadie lee; sin
// TWILIO_SMS_FROM el cron de recordatorios no tocaba ningún envío y no
// avisaba. Ahora la lista está escrita, y la mira /api/health (que devuelve
// 503 si falta alguna en producción, así el monitor externo lo ve en el
// primer deploy) y el cron de salud (que lo cuenta como métrica crítica).
//
// Sólo nombres: acá no se lee ningún valor para otra cosa que saber si está.
//
// Contrato con el área 3: si aparece un validador de entorno único, este
// módulo aporta su lista y desaparece.

export const VARIABLES_OPERACION = [
  // A dónde llega una alerta, y con qué se manda.
  "ALERTA_CORREO",
  "RESEND_API_KEY",
  // Bearer de los crons de Vercel.
  "CRON_SECRET",
  // Host exacto de R2 para la CSP (connect-src): sin él la subida del audio
  // queda fuera de la política.
  "R2_PUBLIC_HOST",
  // SMS.
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_SMS_FROM",
] as const;

export type VariableOperacion = (typeof VARIABLES_OPERACION)[number];

export interface ResultadoEnvOperacion {
  /** Las que faltan o están vacías. */
  faltantes: VariableOperacion[];
  /** true si estamos en producción, donde faltar una es un error. */
  produccion: boolean;
}

/** Pura: recibe el ambiente y dice qué falta. */
export function validarEnvOperacion(
  env: Record<string, string | undefined> = process.env,
): ResultadoEnvOperacion {
  const faltantes = VARIABLES_OPERACION.filter((v) => !env[v]?.trim());
  return { faltantes, produccion: env.NODE_ENV === "production" };
}

/**
 * Lanza si en producción falta alguna. En desarrollo y test no lanza: la
 * app tiene que poder arrancar sin Twilio para tocar la agenda.
 */
export function exigirEnvOperacion(env: Record<string, string | undefined> = process.env): void {
  const { faltantes, produccion } = validarEnvOperacion(env);
  if (produccion && faltantes.length > 0) {
    throw new Error(
      `Faltan variables de operación en producción: ${faltantes.join(", ")}. ` +
        "Sin ellas no hay alertas, o no hay SMS, o la CSP no cubre R2. Ver docs/operaciones.md §2.",
    );
  }
}
