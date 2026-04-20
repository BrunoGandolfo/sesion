"use client";

import { SessionProvider } from "next-auth/react";

// Wrapper client-side para exponer la sesión de next-auth a los
// componentes del dashboard (sidebar, bottom-nav, etc.) vía useSession.
//
// IMPORTANTE: el layout del dashboard debe envolver sus children con
// este componente para que useSession funcione. Ejemplo en
// src/app/(dashboard)/layout.tsx:
//
//   import { Providers } from "@/components/layout/providers";
//   ...
//   <Providers>
//     <Sidebar />
//     <main>{children}</main>
//     <BottomNav />
//   </Providers>
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
