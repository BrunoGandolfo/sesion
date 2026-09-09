"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Calendar,
  Home,
  LogOut,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { PanelAyuda } from "@/components/ayuda/panel-ayuda";
import type { DeudaPaciente } from "@/types/domain";
import { apiGet } from "@/lib/api-client";
import { zonaDeuda } from "@/lib/deudas";
import { DURACION_NAVEGACION, SUAVE } from "@/components/ui/movimiento";
import { Lupita } from "@/components/ui/lupita";
import { LUPITA, NAV, TU_CONSULTORIO } from "@/lib/glosario";

// Mismos destinos que el menú de mobile, más la configuración, que en
// desktop se dice como la diría ella: "Tu consultorio". "Finanzas" pasó a
// ser Cobros y la ruta de deudores salió de la navegación.
const NAV_ITEMS = [
  { href: "/", label: NAV.HOY, icon: Home },
  { href: "/agenda", label: NAV.AGENDA, icon: Calendar },
  { href: "/pacientes", label: NAV.PACIENTES, icon: Users },
  { href: "/cobros", label: NAV.COBROS, icon: Wallet },
] as const;

/** La misma identidad compartida que en el menú de mobile: framer-motion
 *  desliza la marca del destino activo de un ítem al otro en vez de apagarla
 *  acá y prenderla allá. El nombre es distinto del de bottom-nav a propósito:
 *  los dos menús nunca están montados a la vez —uno es lg:hidden y el otro
 *  hidden lg:flex—, pero dos layoutId iguales en el mismo árbol harían que
 *  framer-motion buscara el recorrido entre una barra vertical y un
 *  subrayado horizontal. */
const INDICADOR = "nav-lateral-activo";

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
  const reducido = useReducedMotion();
  const { data: session } = useSession();
  const [redCount, setRedCount] = React.useState(0);
  // La ayuda no es un destino: se abre encima de la pantalla en la que ella
  // está y se cierra ahí mismo. El panel lo monta el menú —hay uno acá y
  // otro en el menú de mobile— para no tocar el layout del dashboard; sólo
  // uno de los dos menús existe en cada viewport, así que nunca hay dos
  // paneles abiertos.
  const [ayudaAbierta, setAyudaAbierta] = React.useState(false);

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
    <>
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
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
                  active
                    ? "bg-sage-50 text-sage-700"
                    : "text-ink-500 hover:bg-cream-50 hover:text-ink-900"
                }`}
              >
                {/* La marca del destino activo. En vertical es una barra
                    contra el borde izquierdo —el equivalente del subrayado
                    de mobile— y se desliza al ítem nuevo. Con movimiento
                    reducido aparece en su lugar, sin recorrido. */}
                {active ? (
                  reducido ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-sage-500"
                    />
                  ) : (
                    <motion.span
                      layoutId={INDICADOR}
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-sage-500"
                      transition={{ duration: DURACION_NAVEGACION, ease: SUAVE }}
                    />
                  )
                ) : null}
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

          {/* Ayuda: mismo tratamiento visual que los destinos, pero es un
              botón —no navega— y nunca queda "activo", porque no hay ruta que
              pueda estarlo. */}
          <button
            type="button"
            onClick={() => setAyudaAbierta(true)}
            className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm font-medium text-ink-500 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 hover:text-ink-900"
          >
            <Lupita pose="saluda" tamano={20} />
            <span className="flex-1">{LUPITA}</span>
          </button>
          <Link
            href="/config"
            aria-label={TU_CONSULTORIO}
            aria-current={isActive("/config") ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium ${isActive("/config") ? "bg-sage-50 text-sage-700" : "text-ink-500 hover:bg-cream-50 hover:text-ink-900"}`}
          >
            <Settings size={18} strokeWidth={1.6} aria-hidden="true" />
            {TU_CONSULTORIO}
          </Link>
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

      <PanelAyuda
        abierto={ayudaAbierta}
        alCerrar={() => setAyudaAbierta(false)}
      />
    </>
  );
}
