// Límites de las invitaciones, decididos por el dueño. Las invitaciones son
// para que una colega PRUEBE la app, no para que la use como consultorio real;
// lo que se limita es grabar, que es lo caro (transcripción y modelo).
//
//   1. Cinco invitaciones en total por cuenta, para siempre.
//   2. Una cada treinta días, contados desde la última generada.
//   3. Quince grabaciones en total por consultorio creado por invitación.
//
// Los contadores viven en la base: `usuarios.invitaciones_generadas` y
// `usuarios.ultima_invitacion_en` (quien invita), y
// `organizaciones.de_invitacion` y `organizaciones.grabaciones_iniciadas`
// (el consultorio invitado). Acá sólo los números y las cuentas puras.

export const TOPE_INVITACIONES_TOTAL = 5;
export const ESPERA_ENTRE_INVITACIONES_DIAS = 30;
export const ESPERA_ENTRE_INVITACIONES_MS = ESPERA_ENTRE_INVITACIONES_DIAS * 24 * 60 * 60 * 1000;
export const TOPE_GRABACIONES_PRUEBA = 15;
/** Desde cuántas grabaciones restantes se avisa que se acerca el tope. */
export const AVISO_GRABACIONES_RESTANTES = 3;

export interface ContadorInvitaciones {
  generadas: number;
  ultimaEn: Date | null;
}

export type CupoInvitacion =
  | { disponible: true; restantes: number }
  | { disponible: false; motivo: "agotadas"; restantes: 0 }
  | { disponible: false; motivo: "espera"; restantes: number; desde: Date };

export function cupoInvitacion({ generadas, ultimaEn }: ContadorInvitaciones, ahora: Date): CupoInvitacion {
  const restantes = Math.max(0, TOPE_INVITACIONES_TOTAL - generadas);
  if (restantes === 0) return { disponible: false, motivo: "agotadas", restantes: 0 };
  if (ultimaEn) {
    const desde = new Date(ultimaEn.getTime() + ESPERA_ENTRE_INVITACIONES_MS);
    if (ahora < desde) return { disponible: false, motivo: "espera", restantes, desde };
  }
  return { disponible: true, restantes };
}

export interface EstadoPrueba {
  usadas: number;
  restantes: number;
  tope: number;
}

/** null si el consultorio no es de prueba: sin límite de grabaciones. */
export function estadoPrueba(org: { deInvitacion: boolean; grabacionesIniciadas: number }): EstadoPrueba | null {
  if (!org.deInvitacion) return null;
  const usadas = Math.min(org.grabacionesIniciadas, TOPE_GRABACIONES_PRUEBA);
  return { usadas, restantes: TOPE_GRABACIONES_PRUEBA - usadas, tope: TOPE_GRABACIONES_PRUEBA };
}
