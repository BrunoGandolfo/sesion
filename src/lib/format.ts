import {
  diasEnterosMvd,
  esMismoDiaMvd,
  formatearDiaSemanaMvd,
  formatearFechaCortaMvd,
  formatearFechaLargaMvd,
  formatearHoraMvd,
  horaLocalMvd,
  mesesEnterosMvd,
} from "@/lib/fechas-montevideo";

import { pluralizar } from "./glosario";

// ============================================
// Moneda — UYU sin centavos
// ============================================

/** "$ 2.200" */
export function money(n: number): string {
  return "$ " + n.toLocaleString("es-UY");
}

/** "$ 2.2k" para KPIs */
export function moneyShort(n: number): string {
  if (n >= 1000) {
    return "$ " + (n % 1000 === 0 ? (n / 1000).toFixed(0) : (n / 1000).toFixed(1)) + "k";
  }
  return "$ " + n;
}

// ============================================
// Fechas — es-UY, hora de Montevideo SIEMPRE.
//
// Estas funciones corren en el servidor (UTC en Vercel, que no deja fijar
// TZ) y en el navegador (la zona de quien mire). Antes usaban date-fns
// sobre la hora del proceso, así que el mismo turno se leía "15:15" en el
// teléfono de la profesional y "18:15" en el SMS que salió del servidor.
//
// Ahora todo pasa por fechas-montevideo: la app es de un consultorio en
// Montevideo y la hora que se muestra es la del consultorio, esté quien
// esté mirando y corra donde corra el proceso.
// ============================================

/** "lunes 20 de abril" */
export function fechaLarga(d: Date): string {
  return formatearFechaLargaMvd(d);
}

/** "20 abr" */
export function fechaCorta(d: Date): string {
  return formatearFechaCortaMvd(d);
}

/** "09:00" */
export function hora(d: Date): string {
  return formatearHoraMvd(d);
}

/**
 * "Hoy", "Ayer", "Hace 3 días", "Hace 1 semana", "Hace 3 semanas",
 * "Hace 1 mes", "Hace 2 meses". Más allá del año, la fecha corta.
 *
 * Antes decía "Hace 2 sem" y "Hace 3 mes": la abreviatura no ahorraba nada
 * en una celda que ya entra holgada, y el singular fijo en "mes" hacía que
 * tres meses se leyeran como tres veces el mismo mes. La palabra entera y
 * bien concordada se lee sin traducir.
 *
 * Los días son días de calendario de Montevideo, no períodos de 24 horas:
 * de una sesión de las 23:00 a la una de la mañana siguiente hay un día,
 * que es lo que diría cualquiera. "Hoy" y "Ayer" se miden contra `desde`
 * (antes se medían siempre contra el reloj real, aunque se pasara otra
 * referencia: un test lo documentaba como rareza).
 */
export function fechaRelativa(d: Date, desde?: Date): string {
  const ref = desde ?? new Date();
  if (esMismoDiaMvd(d, ref)) return "Hoy";

  const dias = diasEnterosMvd(d, ref);
  if (dias === 1) return "Ayer";
  if (dias > 0 && dias < 7) return `Hace ${pluralizar(dias, "día", "días")}`;

  const semanas = Math.floor(dias / 7);
  if (semanas > 0 && semanas < 4) {
    return `Hace ${pluralizar(semanas, "semana", "semanas")}`;
  }

  const meses = mesesEnterosMvd(d, ref);
  if (meses > 0 && meses < 12) {
    return `Hace ${pluralizar(meses, "mes", "meses")}`;
  }

  const anios = Math.floor(meses / 12);
  if (anios > 0) return `Hace ${pluralizar(anios, "año", "años")}`;

  // 28 a 30 días que todavía no completan un mes de calendario (del 31/1 al
  // 28/2). Sin esta línea caían a la fecha corta y la columna mezclaba
  // "Hace 3 semanas" con "28 feb".
  if (semanas > 0) return `Hace ${pluralizar(semanas, "semana", "semanas")}`;

  // Futuro
  const diasFuturo = -dias;
  if (diasFuturo > 0 && diasFuturo < 7) {
    return `En ${pluralizar(diasFuturo, "día", "días")}`;
  }

  return fechaCorta(d);
}

/** "lunes", "martes", etc. */
export function diaSemana(d: Date): string {
  return formatearDiaSemanaMvd(d);
}

/** "Buen día" / "Buenas tardes" / "Buenas noches" */
export function saludo(d?: Date): string {
  const { hora: h } = horaLocalMvd(d ?? new Date());
  if (h < 12) return "Buen día";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

// ============================================
// Avatares — iniciales + color derivado
// ============================================

const AVATAR_TONES = [
  { bg: "#4F7A6A", fg: "#F4F0E8" },
  { bg: "#3E6355", fg: "#F4F0E8" },
  { bg: "#B26B45", fg: "#FBF3EB" },
  { bg: "#A88534", fg: "#FAF4E4" },
  { bg: "#4A6B7D", fg: "#EEF3F5" },
  { bg: "#6F9384", fg: "#F3F6F4" },
] as const;

export function initials(nombre: string, apellido?: string): string {
  if (apellido) return (nombre[0] + apellido[0]).toUpperCase();
  const parts = nombre.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
