"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Users, Wallet } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Hoy", icon: Home },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/pacientes", label: "Pacientes", icon: Users },
  { href: "/finanzas", label: "Finanzas", icon: Wallet },
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
