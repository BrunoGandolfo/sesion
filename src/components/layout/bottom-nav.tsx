"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Home, Calendar, CircleHelp, Users, Wallet } from "lucide-react";

import { PanelAyuda } from "@/components/ayuda/panel-ayuda";
import { SUAVE } from "@/components/ui/movimiento";
import { AYUDA, NAV } from "@/lib/glosario";

// Los cuatro destinos, con el nombre que usa toda la app (glosario NAV).
// "Finanzas" pasó a ser Cobros: el menú nombra lo que se hace ahí, cobrar,
// y la ruta de deudores dejó de tener entrada propia — se llega desde
// Cobros y desde el bloque "Te deben" de la pantalla de Hoy.
const NAV_ITEMS = [
  { href: "/", label: NAV.HOY, icon: Home },
  { href: "/agenda", label: NAV.AGENDA, icon: Calendar },
  { href: "/pacientes", label: NAV.PACIENTES, icon: Users },
  { href: "/cobros", label: NAV.COBROS, icon: Wallet },
] as const;

// Ayuda, el quinto ítem. Es un botón y no un destino: abre un panel encima
// de la pantalla en la que ella está. Va acá y no en un botón flotante
// porque los flotantes que ya hay —el "+" de agendar y el de grabar de la
// ficha— tapan contenido clínico (docs/diseno/01-auditoria-frontend.md), y
// uno más sería el tercero.
//
// Cinco ítems entran: a 360 px de ancho tocan a 72 px cada uno, bien arriba
// de los 44 del mínimo táctil. El sexto sí apretaría —60 px, y "Pacientes"
// mide casi eso—, así que si algún día entra "Vos" (la alternativa A de la
// auditoría, que reclama este mismo lugar para "Tu consultorio"), la ayuda
// se va de acá antes que quedar los dos.

/** Identidad compartida del subrayado: framer-motion lo desliza entre
 *  pestañas en vez de apagarlo acá y prenderlo allá. */
const INDICADOR = "nav-activo";

/** Lo que tarda el subrayado en llegar a la pestaña nueva. El mismo valor
 *  que la marca del destino activo en la barra lateral: es la misma
 *  navegación, en el otro viewport. */
const DURACION_INDICADOR = 0.26;

export function BottomNav() {
  const pathname = usePathname();
  const reducido = useReducedMotion();
  const [ayudaAbierta, setAyudaAbierta] = React.useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex border-t bg-white lg:hidden"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors duration-[var(--duration-fast)] ${
                active ? "text-sage-600" : "text-ink-300"
              }`}
            >
              {active ? (
                // Con movimiento reducido es una barra que aparece en su
                // lugar; sin layoutId no hay recorrido entre pestañas.
                reducido ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-sage-500"
                  />
                ) : (
                  <motion.span
                    layoutId={INDICADOR}
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-sage-500"
                    transition={{ duration: DURACION_INDICADOR, ease: SUAVE }}
                  />
                )
              ) : null}
              <Icon size={22} strokeWidth={active ? 2 : 1.6} />
              {label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setAyudaAbierta(true)}
          className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold text-ink-300 transition-colors duration-[var(--duration-fast)]"
        >
          <CircleHelp size={22} strokeWidth={1.6} aria-hidden="true" />
          {AYUDA}
        </button>
      </nav>

      <PanelAyuda
        abierto={ayudaAbierta}
        alCerrar={() => setAyudaAbierta(false)}
      />
    </>
  );
}
