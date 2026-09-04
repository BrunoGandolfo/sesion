"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Calendar,
  Home,
  LogOut,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import type { DeudaPaciente } from "@/types/domain";
import { apiGet } from "@/lib/api-client";
import { zonaDeuda } from "@/lib/deudas";
import { NAV, TU_CONSULTORIO } from "@/lib/glosario";

// Mismos destinos que el menú de mobile, más la configuración, que en
// desktop se dice como la diría ella: "Tu consultorio". "Finanzas" pasó a
// ser Cobros y la ruta de deudores salió de la navegación.
const NAV_ITEMS = [
  { href: "/", label: NAV.HOY, icon: Home },
  { href: "/agenda", label: NAV.AGENDA, icon: Calendar },
  { href: "/pacientes", label: NAV.PACIENTES, icon: Users },
  { href: "/cobros", label: NAV.COBROS, icon: Wallet },
  { href: "/config", label: TU_CONSULTORIO, icon: Settings },
] as const;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getFirstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "Sesión";
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [redCount, setRedCount] = React.useState(0);

  const name = session?.user?.name?.trim() || "Usuario";
  const initials = getInitials(name);
  const firstName = getFirstName(name);

  // Cuenta de deudores en zona terracotta (31+ días). Refetch al cambiar de
  // ruta dentro del dashboard para mantener el badge razonablemente fresco
  // (el sidebar vive en el layout y no se desmonta entre páginas).
  React.useEffect(() => {
    let cancelled = false;
    apiGet<DeudaPaciente[]>("/api/deudores")
      .then((deudores) => {
        if (cancelled) return;
        setRedCount(
          deudores.filter((d) => zonaDeuda(d.diasAtraso) === "terracotta")
            .length,
        );
      })
      .catch(() => {
        /* silencioso: el badge es informativo, no crítico */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden lg:flex w-60 flex-col flex-shrink-0 border-r bg-cream-100" style={{ borderColor: "var(--border-subtle)" }}>
      {/* Wordmark */}
      <div className="px-6 py-6">
        <div className="flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)] text-[22px] font-medium tracking-tight text-ink-900 leading-none">
            {firstName}
          </span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage-500" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const showBadge = href === "/cobros" && redCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
                active
                  ? "bg-sage-50 text-sage-700"
                  : "text-ink-500 hover:bg-cream-50 hover:text-ink-900"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.6} />
              <span className="flex-1">{label}</span>
              {showBadge ? (
                <span
                  aria-label={`${redCount} ${redCount === 1 ? "deudor" : "deudores"} con más de 30 días`}
                  className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-terracotta-500 px-1.5 text-[10px] font-semibold leading-[18px] text-white"
                >
                  {redCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto border-t px-4 py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sage-500 font-[family-name:var(--font-display)] text-xs font-medium text-cream-100">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink-900 truncate">{name}</div>
            <div className="text-[11px] text-ink-500">Consultorio</div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-ink-500 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 hover:text-ink-900"
          >
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </aside>
  );
}
