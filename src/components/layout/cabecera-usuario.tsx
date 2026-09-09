"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

import { fechaCorta, initials, saludo } from "@/lib/format";
import { TU_CONSULTORIO } from "@/lib/glosario";

// Decisión de producto: el nombre identifica a la profesional; no navega.
// La configuración se reconoce por el engranaje arriba a la derecha,
// separado del saludo y con el mismo destino en todas las cabeceras.

export function AccesoConsultorio({ activo = false }: { activo?: boolean }) {
  if (activo) {
    return (
      <span role="img" aria-label={TU_CONSULTORIO} aria-current="page" title={TU_CONSULTORIO}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-sage-50 text-sage-700">
        <Settings size={22} strokeWidth={1.8} aria-hidden="true" />
      </span>
    );
  }
  return (
    <Link
      href="/config"
      aria-label={TU_CONSULTORIO}
      title={TU_CONSULTORIO}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-cream-100 hover:text-sage-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sage-500/20"
    >
      <Settings size={22} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}

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
    <div className={`flex w-full min-w-0 items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream-100 font-[family-name:var(--font-display)] text-[16px] font-medium leading-none text-sage-700 ring-1 ring-sage-200"
        >
          {iniciales}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="break-words font-[family-name:var(--font-display)] text-[24px] font-medium leading-tight text-ink-900 lg:text-[30px]">
            {visible}
          </span>
          {ahora ? (
            <span className="font-sans text-[12px] leading-tight text-ink-500">
              {conSaludo ? `${saludo(ahora)} · ` : null}
              {fechaCorta(ahora)}
            </span>
          ) : null}
        </span>
      </div>
      <AccesoConsultorio />
    </div>
  );
}
