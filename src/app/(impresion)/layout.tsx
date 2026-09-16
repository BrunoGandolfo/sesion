import { redirect } from "next/navigation";

import { buscarActor } from "@/app/api/_lib/auth";
import { PARAM_SESION_VENCIDA } from "@/lib/sesion-cookie";

import "./impresion.css";

// Hojas para imprimir o guardar en PDF. Grupo aparte del dashboard para que
// no arrastren la barra lateral, el menú inferior ni el aviso de versión: lo
// que se ve es lo que sale en el papel. Las fuentes y los tokens vienen del
// layout raíz (fonts.ts y globals.css), igual que en el resto de la app.
//
// force-dynamic por lo mismo que (dashboard) y (auth): una página
// prerenderizada sale sin nonce y ensucia los reportes de CSP (AGENTS.md).

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

export default async function ImpresionLayout({ children }: { children: React.ReactNode }) {
  // Misma comprobación que el layout del dashboard: el proxy solo miró la cookie.
  const actor = await buscarActor();
  if (!actor) redirect(`/login?${PARAM_SESION_VENCIDA}=vencida`);
  return <>{children}</>;
}
