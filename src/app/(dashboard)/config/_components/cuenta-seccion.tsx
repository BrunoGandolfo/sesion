"use client";

// La cuenta, al pie de Tu consultorio: quién está adentro, cambiar la
// contraseña, cerrar las otras sesiones y salir.

import * as React from "react";
import { LogOut } from "lucide-react";

import { useSesionActual } from "@/components/layout/providers";
import { Button, Card, Input } from "@/components/ui";
import { useEnvio } from "@/hooks/useEnvio";
import { apiPost } from "@/lib/api-client";
import {
  ALGO_FALLO,
  OTRAS_SESIONES_BOTON,
  OTRAS_SESIONES_CERRANDO,
  OTRAS_SESIONES_DESCRIPCION,
  PASSWORD_AVISO_CIERRE,
  otrasSesionesCerradas,
} from "@/lib/glosario";
import { PASSWORD_MIN, validarPasswordNueva } from "@/lib/password";
import { salir } from "@/lib/sesion-cliente";

import { TituloSeccion } from "./titulo-seccion";

export function CuentaSeccion({ nombreProfesional }: { nombreProfesional: string }) {
  const emailSesion = useSesionActual()?.email ?? null;

  return (
    <section className="pt-2">
      <TituloSeccion>Cuenta</TituloSeccion>
      <Card className="!p-6">
        <div className="flex flex-col gap-5">
          <div className="min-w-0">
            <p className="truncate font-display text-[20px] font-medium leading-tight text-ink-900">
              {nombreProfesional || "Tu cuenta"}
            </p>
            {emailSesion ? (
              <p className="mt-1 truncate text-[13px] text-ink-500">
                {emailSesion}
              </p>
            ) : null}
          </div>
          <CambiarPassword />
          <CerrarOtrasSesiones />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              icon={<LogOut size={16} strokeWidth={2} aria-hidden="true" />}
              className="w-full sm:w-auto"
              onClick={() => {
                void salir();
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cambiar la contraseña
//
// Reemplaza al botón "Cambiar contraseña · próximamente", que era un botón
// deshabilitado con una promesa. Va inline en la card de Cuenta y no en un
// sheet: son tres campos y no hay nada que se pierda de vista detrás.
//
// La regla del largo sale de @/lib/password (validarPasswordNueva), la misma
// que aplica la ruta: acá se valida para no hacer un viaje de red por un
// error que ya se puede ver, no para reemplazar la validación del servidor.
// ────────────────────────────────────────────────────────────────────────────

function CambiarPassword() {
  const [abierto, setAbierto] = React.useState(false);
  const [actual, setActual] = React.useState("");
  const [nueva, setNueva] = React.useState("");
  const [repetir, setRepetir] = React.useState("");
  const limpiar = () => {
    setActual("");
    setNueva("");
    setRepetir("");
    setError("");
  };
  const { enviar: cambiar, enviando, error, setError } = useEnvio(async () => {
    await apiPost("/api/cuenta/password", { actual, nueva });
  }, ALGO_FALLO);


  const cerrar = () => {
    limpiar();
    setAbierto(false);
  };

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;

    if (nueva !== repetir) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }

    const validacion = validarPasswordNueva(nueva, actual);
    if (!validacion.ok) {
      setError(validacion.motivo);
      return;
    }

    if (!(await cambiar())) return;
    limpiar();
    setAbierto(false);
    // El servidor cerró todas las sesiones, incluida esta: la cookie ya no
    // vale. A /login con el aviso, sin pasar por el proxy con cookie muerta.
    // Recargar descarta el estado privado en memoria tras revocar la sesión.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- El cierre de sesión requiere una navegación completa.
    window.location.assign("/login?aviso=password-cambiada");
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => setAbierto(true)}
      >
        Cambiar contraseña
      </Button>
    );
  }

  return (
    <form
      onSubmit={(event) => void enviar(event)}
      className="flex flex-col gap-4 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-4"
    >
      <Input
        label="Contraseña actual"
        type="password"
        autoComplete="current-password"
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        disabled={enviando}
        required
      />
      <Input
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        value={nueva}
        onChange={(e) => setNueva(e.target.value)}
        disabled={enviando}
        required
      />
      <Input
        label="Repetila"
        type="password"
        autoComplete="new-password"
        value={repetir}
        onChange={(e) => setRepetir(e.target.value)}
        disabled={enviando}
        required
      />

      <p className="text-[12px] leading-[1.5] text-ink-500">
        Al menos {PASSWORD_MIN} caracteres. {PASSWORD_AVISO_CIERRE}
      </p>

      {error ? (
        <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={cerrar}
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Cambiando…" : "Cambiar contraseña"}
        </Button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cerrar sesión en los demás dispositivos
//
// POST /api/cuenta/salir-todas cierra todas las sesiones vivas menos la
// actual. Existe porque ahora la sesión vive en la base y se puede apagar de
// verdad; antes el token de 30 días no se podía revocar.
// ────────────────────────────────────────────────────────────────────────────

function CerrarOtrasSesiones() {
  const [resultado, setResultado] = React.useState<string | null>(null);
  const { enviar, enviando, error } = useEnvio(async () => {
    setResultado(null);
    const { cerradas } = await apiPost<{ cerradas: number }>("/api/cuenta/salir-todas", {});
    setResultado(otrasSesionesCerradas(cerradas));
  }, ALGO_FALLO);

  async function cerrar() {
    await enviar();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        disabled={enviando}
        onClick={() => void cerrar()}
      >
        {enviando ? OTRAS_SESIONES_CERRANDO : OTRAS_SESIONES_BOTON}
      </Button>
      <p className="text-[12px] leading-[1.5] text-ink-500">{OTRAS_SESIONES_DESCRIPCION}</p>
      {resultado ? (
        <p role="status" className="text-[13px] text-sage-600">
          {resultado}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-[color:var(--color-error)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
