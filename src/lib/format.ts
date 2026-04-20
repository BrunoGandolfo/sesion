import { format, isToday, isYesterday, differenceInDays, differenceInWeeks, differenceInMonths } from "date-fns";
import { es } from "date-fns/locale";

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
// Fechas — es-UY, zona Montevideo
// ============================================

/** "lunes 20 de abril" */
export function fechaLarga(d: Date): string {
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}

/** "20 abr" */
export function fechaCorta(d: Date): string {
  return format(d, "d MMM", { locale: es });
}

/** "09:00" */
export function hora(d: Date): string {
  return format(d, "HH:mm");
}

/** "Hoy", "Ayer", "Hace 3 días", "Hace 2 sem", "Hace 3 mes" */
export function fechaRelativa(d: Date, desde?: Date): string {
  const ref = desde ?? new Date();
  if (isToday(d)) return "Hoy";
  if (isYesterday(d)) return "Ayer";

  const dias = differenceInDays(ref, d);
  if (dias > 0 && dias < 7) return `Hace ${dias} días`;
  
  const semanas = differenceInWeeks(ref, d);
  if (semanas > 0 && semanas < 4) return `Hace ${semanas} sem`;
  
  const meses = differenceInMonths(ref, d);
  if (meses > 0) return `Hace ${meses} mes`;

  // Futuro
  const diasFuturo = differenceInDays(d, ref);
  if (diasFuturo > 0 && diasFuturo < 7) return `En ${diasFuturo} día${diasFuturo === 1 ? "" : "s"}`;

  return fechaCorta(d);
}

/** "lunes", "martes", etc. */
export function diaSemana(d: Date): string {
  return format(d, "EEEE", { locale: es });
}

/** "Buen día" / "Buenas tardes" / "Buenas noches" */
export function saludo(d?: Date): string {
  const h = (d ?? new Date()).getHours();
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
