// Qué se dibuja según cómo va la lectura de una pantalla y si ya hay datos.
// Hoy y Cobros lo resolvían a mano, y ninguna tenía la fila de "falló una
// recarga pero hay datos": el error solo se veía la primera vez, y después
// de cobrar o agendar, si la recarga fallaba, la pantalla seguía con los
// datos viejos sin decir nada (forense 03, P3-22 y P3-23).
//
//   carga      | datos | se ve
//   -----------|-------|------------------------------------------
//   cargando   | no    | el esqueleto
//   error      | no    | el error de la pantalla, con Reintentar
//   error      | sí    | un aviso con Reintentar, y los datos
//   cargando   | sí    | los datos, con aria-busy
//   listo      | sí    | los datos
//   vencida    | no/sí | "Tu sesión venció", con Entrar (y los datos, si hay)
//
// `vencida` es el 401 que arma api-client (lanzarSiNoOk/fueAlLogin) cuando
// la lectura vuelve redirigida al login: Reintentar no sirve, hay que entrar
// de nuevo. Lux y la ayuda dicen lo mismo (SESION_VENCIDA).

import * as React from "react";

import { ApiClientError } from "@/lib/api-client";
import { DATOS_SIN_ACTUALIZAR, ENTRAR, REINTENTAR, SESION_VENCIDA } from "@/lib/glosario";
import { PARAM_SESION_VENCIDA } from "@/lib/sesion-cookie";

export type Carga = "cargando" | "listo" | "error" | "vencida";

/** La carga que corresponde a una lectura que falló. */
export function cargaDelError(err: unknown): Carga {
  return err instanceof ApiClientError && err.esNoAutorizado ? "vencida" : "error";
}

/**
 * `children` recibe los datos, el aviso (null si no hace falta) para que la
 * pantalla lo ubique dentro de su contenedor, y `ocupado` para el
 * aria-busy mientras recarga.
 */
export function SegunLectura<T>({
  carga,
  datos,
  esqueleto,
  error,
  onReintentar,
  children,
}: {
  carga: Carga;
  datos: T | null;
  esqueleto: React.ReactNode;
  /** El error de la primera lectura, cuando no hay nada que mostrar. */
  error: React.ReactNode;
  onReintentar: () => void;
  children: (
    datos: T,
    estado: { aviso: React.ReactNode; ocupado: boolean },
  ) => React.ReactNode;
}) {
  if (carga === "vencida" && datos === null) return <AvisoSesionVencida />;
  if (datos === null) return <>{carga === "error" ? error : esqueleto}</>;
  const aviso =
    carga === "vencida" ? <AvisoSesionVencida /> :
    carga === "error" ? <AvisoSinActualizar onReintentar={onReintentar} /> : null;
  return <>{children(datos, { aviso, ocupado: carga === "cargando" })}</>;
}

export function AvisoSinActualizar({ onReintentar }: { onReintentar: () => void }) {
  return (
    <p role="alert" className="text-[13px] text-ink-700">
      {DATOS_SIN_ACTUALIZAR}{" "}
      <button
        type="button"
        onClick={onReintentar}
        className="min-h-11 font-medium text-sage-600 underline underline-offset-2"
      >
        {REINTENTAR}
      </button>
    </p>
  );
}

/** Un enlace de verdad y no <Link>: se entra de cero, sin el estado de la
 *  sesión que venció. Con el parámetro, el proxy deja ver el login aunque
 *  quede la cookie vieja. */
export function AvisoSesionVencida() {
  return (
    <p role="alert" className="text-[13px] text-ink-700">
      {SESION_VENCIDA}{" "}
      <a
        href={`/login?${PARAM_SESION_VENCIDA}=vencida`}
        className="inline-flex min-h-11 items-center font-medium text-sage-600 underline underline-offset-2"
      >
        {ENTRAR}
      </a>
    </p>
  );
}
