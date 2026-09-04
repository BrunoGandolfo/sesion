"use client";

import Link from "next/link";

import { fechaCorta, initials, saludo } from "@/lib/format";
import { TU_CONSULTORIO } from "@/lib/glosario";

// Quién sos y qué día es, arriba a la izquierda, y toda la cabecera lleva a
// "Tu consultorio".
//
// Antes había dos accesos distintos a lo mismo: en Hoy el nombre propio era
// un enlace subrayado con un engranaje al lado, y en Cobros un engranaje
// suelto arriba a la derecha. Dos formas, dos lugares, y ninguna se parecía
// a cómo se entra a la configuración en el resto de las apps que ella usa:
// tocando tu propia foto.
//
// El avatar hace de ancla visual: es lo que se reconoce de lejos, y lo que
// hace que un enlace de tres líneas se lea como un solo destino.

interface CabeceraUsuarioProps {
  /** Nombre de la profesional. null mientras carga la configuración. */
  nombre: string | null;
  /** Momento a mostrar. null mientras no hay reloj de cliente. */
  ahora: Date | null;
  /** Antepone "Buenas tardes". Solo en Hoy: es la pantalla del día. */
  conSaludo?: boolean;
  className?: string;
}

/** Primera palabra: en la cabecera entra el nombre, no el nombre completo. */
function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

export function CabeceraUsuario({
  nombre,
  ahora,
  conSaludo = false,
  className = "",
}: CabeceraUsuarioProps) {
  const tieneNombre = Boolean(nombre && nombre.trim());
  const visible = tieneNombre ? primerNombre(nombre as string) : TU_CONSULTORIO;
  // Sin nombre todavía, el avatar muestra un punto en vez de dos letras
  // inventadas.
  const iniciales = tieneNombre ? initials(nombre as string) : "·";

  return (
    <Link
      href="/config"
      aria-label={TU_CONSULTORIO}
      title={TU_CONSULTORIO}
      className={`group inline-flex min-w-0 items-center gap-3 rounded-md py-1 pr-2 transition-colors duration-150 hover:bg-cream-100 focus:outline-none focus:ring-[3px] focus:ring-sage-500/20 ${className}`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream-100 font-[family-name:var(--font-display)] text-[16px] font-medium leading-none text-sage-700 ring-1 ring-sage-200 transition-colors duration-150 group-hover:bg-cream-200"
      >
        {iniciales}
      </span>

      <span className="flex min-w-0 flex-col">
        {conSaludo && ahora ? (
          <span className="truncate font-sans text-[12px] leading-tight text-ink-500">
            {saludo(ahora)}
          </span>
        ) : null}
        <span className="truncate font-sans text-[15px] font-semibold leading-tight text-ink-900">
          {visible}
        </span>
        {ahora ? (
          <span className="truncate font-sans text-[12px] leading-tight text-ink-300">
            {fechaCorta(ahora)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
