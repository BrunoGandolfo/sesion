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
//
// Y dejó de ser lo más grande de la pantalla. "lunes" medía 52 px y se comía
// un cuarto de la primera pantalla para decir algo que ella ya sabe; justo
// debajo, en 13 px, iba el único dato que le cambia el día. La jerarquía
// estaba al revés de la importancia: lo más grande de Hoy tiene que ser qué
// sesión viene ahora (card-ahora.tsx), no qué día es. Ahora el día y la
// cuenta de sesiones van en una sola línea, del tamaño de un subtítulo.

import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { diaSemana, fechaLarga } from "@/lib/format";
import { HOY_SIN_SESIONES, pluralizar } from "@/lib/glosario";

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

      <h1 className="mt-3 flex flex-wrap items-baseline gap-x-2 font-[family-name:var(--font-display)] text-[24px] font-medium italic leading-tight tracking-[-0.02em] text-ink-900 lg:text-[30px]">
        {diaSemana(ahora)}
        <span className="font-sans text-[13px] font-normal not-italic tracking-normal text-ink-500">
          {sesiones > 0
            ? pluralizar(sesiones, "sesión en el día", "sesiones en el día")
            : HOY_SIN_SESIONES}
        </span>
      </h1>
    </section>
  );
}
