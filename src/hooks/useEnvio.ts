"use client";

import * as React from "react";

import { mensajeParaElla } from "@/lib/api-client";

/**
 * El ciclo de un formulario que se manda una vez: enviando, error y el
 * try/catch/finally. Estaba escrito siete veces (las cuatro pantallas de
 * entrada, cambiar la contraseña, cerrar las otras sesiones e invitar a una
 * colega), con dos convenciones para leer el error (forense 03, P3-19).
 *
 * `enviar` no hace nada si ya hay un envío en vuelo, y devuelve true si
 * `fn` terminó bien. El error es el que mandó la API (`mensajeParaElla`) o
 * `porDefecto`; `describir` lo reemplaza cuando la pantalla tiene que decir
 * siempre lo mismo (recuperar la contraseña no confirma si el email existe).
 * La validación previa (contraseñas que no coinciden) la hace la pantalla con
 * `setError`.
 */
export function useEnvio<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  porDefecto: string,
  describir: (err: unknown) => string = (err) => mensajeParaElla(err, porDefecto),
): {
  enviar: (...args: A) => Promise<boolean>;
  enviando: boolean;
  error: string;
  setError: (mensaje: string) => void;
} {
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState("");
  const enVuelo = React.useRef(false);

  const enviar = async (...args: A): Promise<boolean> => {
    if (enVuelo.current) return false;
    enVuelo.current = true;
    setEnviando(true);
    setError("");
    try {
      await fn(...args);
      return true;
    } catch (err) {
      setError(describir(err));
      return false;
    } finally {
      enVuelo.current = false;
      setEnviando(false);
    }
  };

  return { enviar, enviando, error, setError };
}
