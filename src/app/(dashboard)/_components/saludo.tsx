// El encabezado de Hoy: quién sos, qué día es y cuántas sesiones hay.
//
// La cabecera de usuario (avatar + saludo + nombre + fecha) reemplazó al
// nombre subrayado con un engranaje al lado: era un enlace que había que
// descubrir, y el engranaje repetía el mismo destino en un ícono distinto.
// Ahora hay un solo bloque tocable y se parece a como se entra a la
// configuración en cualquier app que ella ya usa.
//
// El día en grande dejó de repetir "4 sep": esa fecha ya está, en chico,
// en la cabecera. Acá queda el día de la semana, que es lo que orienta.

import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { diaSemana, fechaLarga } from "@/lib/format";
import { pluralizar } from "@/lib/glosario";

export function Saludo({
  ahora,
  nombre,
  sesiones,
}: {
  ahora: Date;
  nombre: string | null;
  sesiones: number;
}) {
  return (
    <section aria-label={fechaLarga(ahora)} className="min-w-0">
      <CabeceraUsuario nombre={nombre} ahora={ahora} conSaludo />

      <h1 className="mt-4 font-[family-name:var(--font-display)] text-[52px] font-medium italic leading-[0.92] tracking-[-0.03em] text-ink-900 lg:text-[80px]">
        {diaSemana(ahora)}
      </h1>

      <p className="mt-2 text-[13px] text-ink-500">
        {sesiones > 0
          ? pluralizar(sesiones, "sesión en el día", "sesiones en el día")
          : "sin sesiones agendadas"}
      </p>
    </section>
  );
}
