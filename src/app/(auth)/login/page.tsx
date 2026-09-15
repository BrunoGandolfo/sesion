"use client";

// En móvil, el formulario va antes de la explicación. En escritorio se
// conserva la presencia a la izquierda mediante el orden visual de las columnas.
// Los textos viven en glosario.ts.
//
// Entrar es un POST a /api/cuenta/entrar: el servidor verifica, abre la
// sesión en la base y deja la cookie. Si llegamos acá con ?sesion=vencida
// (el layout del dashboard encontró una cookie que ya no resuelve a una
// sesión viva), primero se le pide al servidor que la borre, así el proxy no
// nos manda de vuelta a / con una cookie muerta.


import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button, Card, Input } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { ENTRADA_REINGRESO,
  ENTRADA_CONTRASENA,
  ENTRADA_EMAIL,
  ENTRADA_ERROR,
  ENTRADA_ERROR_DETALLE,
  ENTRADA_OLVIDASTE,
  ENTRADA_PASSWORD_CAMBIADA,
  ENTRANDO,
  ENTRAR,
} from "@/lib/glosario";

import { Presencia } from "./_components/presencia";

// Texto nuevo de esta pantalla; va al glosario cuando el área 6 lo integre
// (docs/pendientes/03-identidad.md).


export default function LoginPage() {
  const router = useRouter();
  const parametros = useSearchParams();
  const aviso = parametros.get("aviso") === "password-cambiada";
  const sesionVencida = parametros.has("sesion");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!sesionVencida) return;
    // /limpiar borra la cookie SOLO si no resuelve a una sesión viva: una
    // navegación inducida a /login?sesion=x no puede cerrar una sesión ajena
    // (auditoría de Codex, docs/pendientes/03-identidad.md §8).
    void fetch("/api/cuenta/limpiar", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  }, [sesionVencida]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    setLoading(true);
    try {
      await apiPost("/api/cuenta/entrar", { email, password });
      router.push("/");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-6 py-12 lg:max-w-[1020px] lg:flex-row lg:items-center lg:justify-center lg:gap-20 lg:px-12">
        <div className="flex w-full flex-col lg:w-[380px] lg:shrink-0">
          <Card className="p-7 shadow-subtle">
            {aviso && (
              <p role="status" className="mb-4 text-sm text-sage-600">
                {ENTRADA_PASSWORD_CAMBIADA}. {ENTRADA_REINGRESO}
              </p>
            )}
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <Input
                label={ENTRADA_EMAIL}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={loading}
                required
              />
              <Input
                label={ENTRADA_CONTRASENA}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={loading}
                required
              />

              <Button type="submit" className="mt-[6px] w-full px-5 py-[13px]" disabled={loading}>
                {loading ? ENTRANDO : ENTRAR}
              </Button>
              <Link href="/recuperar" className="text-center text-sm text-sage-600 underline">
                {ENTRADA_OLVIDASTE}
              </Link>

              {/* Un solo mensaje para todos los casos: contraseña equivocada,
                  email que no existe y acceso bloqueado por intentos. */}
              {error ? (
                <div role="alert" className="mt-2 flex flex-col gap-1">
                  <p className="text-[12px] text-[color:var(--color-error)]">{ENTRADA_ERROR}</p>
                  <p className="text-[11px] leading-[1.45] text-ink-500">{ENTRADA_ERROR_DETALLE}</p>
                </div>
              ) : null}
            </form>
          </Card>

          <p className="mt-6 text-center text-[12px] text-ink-500">
            v1.0 · hecho con cuidado
          </p>

        </div>
        <div className="mt-8 w-full lg:order-first lg:mt-0 lg:min-w-0">
          <Presencia />
        </div>
      </div>
    </main>
  );
}
