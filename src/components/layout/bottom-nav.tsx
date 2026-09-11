"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Home, Calendar, Users, Wallet } from "lucide-react";

import { PanelAyuda } from "@/components/ayuda/panel-ayuda";
import { DURACION_NAVEGACION, SUAVE } from "@/components/ui/movimiento";
import { LupitaMenu } from "@/components/ui/lupita";
import { LUPITA, NAV } from "@/lib/glosario";

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

// Lupita es el quinto ítem por decisión de producto. Abre el panel sobre
// la pantalla actual; la configuración tiene su engranaje en la cabecera.

/** Identidad compartida del subrayado: framer-motion lo desliza entre
 *  pestañas en vez de apagarlo acá y prenderlo allá. */
const INDICADOR = "nav-activo";

export function BottomNav() {
  const pathname = usePathname();
  const reducido = useReducedMotion();
  const [toquesLupita, setToquesLupita] = React.useState(0);
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
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[12px] leading-[15px] font-semibold transition-colors duration-[var(--duration-fast)] ${
                active ? "text-sage-600" : "text-ink-500"
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
                    transition={{ duration: DURACION_NAVEGACION, ease: SUAVE }}
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
          onClick={() => {
            setToquesLupita((toques) => toques + 1);
            setAyudaAbierta(true);
          }}
          className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[12px] leading-[15px] font-semibold text-ink-500 transition-colors duration-[var(--duration-fast)]"
        >
          <LupitaMenu toque={toquesLupita} />
          {LUPITA}
        </button>
      </nav>

      <PanelAyuda
        abierto={ayudaAbierta}
        alCerrar={() => setAyudaAbierta(false)}
      />
    </>
  );
}
