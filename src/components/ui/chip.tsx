import type { ReactNode } from "react";

type ChipVariant = "sage" | "terracotta" | "gold" | "neutral";
type ChipSize = "default" | "sm";
/**
 * Qué lleva adentro el chip, que es lo que decide si puede envolver:
 *
 *   "estado" — un rótulo corto y cerrado ("Pagado", "Para revisar", "Señal
 *     de riesgo"). Va en versalitas y en una sola línea: son tres palabras
 *     como mucho y partirlas se lee peor.
 *   "libre" — texto que escribe el modelo o la profesional: un tema del
 *     hilo, un término del vocabulario. Envuelve, en minúscula.
 *
 * Por qué existe la distinción: con `whitespace-nowrap` para todos, el tema
 * "devolución diagnóstica e inestabilidad emocional · 1" producía un chip de
 * 423 px en el brief pre-sesión y la ficha desbordaba 74 px sobre un
 * viewport de 390, dentro de un layout `overflow-hidden`. O sea: texto
 * clínico recortado, en la pantalla que ella lee un minuto antes de que
 * entre la paciente (docs/diseno/01-auditoria-frontend.md, sección 0).
 *
 * El dibujo de "libre" no es nuevo: es el que el Recorrido ya usaba a mano
 * para el mismo dato (ContextoGoldenThreadView), que por eso envolvía bien.
 * Ahora los dos salen del mismo componente y el mismo tema se ve igual en
 * las dos pestañas de la ficha.
 */
type ChipTexto = "estado" | "libre";

interface ChipProps {
  variant?: ChipVariant;
  size?: ChipSize;
  texto?: ChipTexto;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<ChipVariant, string> = {
  sage: "bg-sage-100 text-sage-700",
  terracotta: "bg-terracotta-50 text-terracotta-600",
  gold: "bg-gold-50 text-gold-500",
  neutral: "bg-cream-100 text-ink-700",
};

// 12px es el piso, en los dos tamaños. Los chips llevan estado clínico
// ("Para revisar", "Señal de riesgo", "Pagado") y venían en 10 y 9 píxeles,
// en mayúsculas y con tracking: ilegible a un brazo de distancia para quien
// usa la app entre sesión y sesión. `sm` sigue siendo más compacto, pero por
// el aire, no por el cuerpo de la letra.
const sizeClasses: Record<ChipSize, string> = {
  default: "px-[10px] py-[4px] text-[12px]",
  sm: "px-2 py-[3px] text-[12px]",
};

// Un chip de estado no parte nunca; uno de texto libre envuelve y, si le
// toca una sola palabra larguísima, la corta antes que salirse.
const textoClasses: Record<ChipTexto, string> = {
  estado: "font-semibold uppercase tracking-[0.08em] whitespace-nowrap",
  libre: "max-w-full break-words text-left",
};

export function Chip({
  variant = "neutral",
  size = "default",
  texto = "estado",
  children,
  className = "",
}: ChipProps) {
  return (
    <span
      data-texto={texto}
      className={`inline-flex items-center rounded-full font-sans ${textoClasses[texto]} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  );
}
