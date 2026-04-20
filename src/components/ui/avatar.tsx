import { initials, avatarColor } from "@/lib/format";

interface AvatarProps {
  nombre: string;
  apellido?: string;
  size?: number;
  className?: string;
}

export function Avatar({
  nombre,
  apellido,
  size = 40,
  className = "",
}: AvatarProps) {
  const key = apellido ? `${nombre} ${apellido}` : nombre;
  const tone = avatarColor(key);
  const init = initials(nombre, apellido);

  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full font-display font-medium select-none shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundColor: tone.bg,
        color: tone.fg,
        lineHeight: 1,
      }}
    >
      {init}
    </span>
  );
}
