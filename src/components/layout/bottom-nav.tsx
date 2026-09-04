"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Users, Wallet } from "lucide-react";

import { NAV } from "@/lib/glosario";

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

export function BottomNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t bg-white lg:hidden" style={{ borderColor: "var(--border-subtle)" }}>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors duration-[var(--duration-fast)] ${
              active ? "text-sage-600" : "text-ink-300"
            }`}
          >
            <Icon size={22} strokeWidth={active ? 2 : 1.6} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
