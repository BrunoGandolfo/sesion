"use client";

import * as React from "react";
import { ProteccionTrabajo } from "./proteccion-trabajo";

// Quién está entrada, para los componentes cliente del dashboard (sidebar,
// configuración). Lo alimenta el layout del dashboard, que es un componente
// de servidor y resuelve la sesión con getSessionActor(): acá no hay fetch
// ni proveedor externo. Reemplaza al SessionProvider de next-auth.

export interface UsuariaActual {
  nombre: string;
  email: string;
}

const SesionContext = React.createContext<UsuariaActual | null>(null);

export function Providers({
  usuaria,
  children,
}: {
  usuaria: UsuariaActual;
  children: React.ReactNode;
}) {
  return <SesionContext.Provider value={usuaria}><ProteccionTrabajo>{children}</ProteccionTrabajo></SesionContext.Provider>;
}

/** La usuaria de la sesión, o null fuera del dashboard. */
export function useSesionActual(): UsuariaActual | null {
  return React.useContext(SesionContext);
}
