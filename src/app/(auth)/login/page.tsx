"use client";

// En móvil, el formulario va antes de la explicación. En escritorio se
// conserva la presencia a la izquierda mediante el orden visual de las columnas.

import * as React from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import {
  ENTRADA_OLVIDASTE, ENTRADA_PASSWORD_CAMBIADA,
  ENTRADA_CONTRASENA,
  ENTRADA_EMAIL,
  ENTRADA_ERROR,
  ENTRADA_ERROR_DETALLE,
  ENTRANDO,
  ENTRAR,
} from "@/lib/glosario";
import { Presencia } from "./_components/presencia";

export default function LoginPage() {
  const router = useRouter();
  const aviso = useSearchParams().get("aviso") === "password-cambiada";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.ok && !result.error) {
      router.push("/");
      router.refresh();
      return;
    }

    setError(true);
  }

  return (
    <main className="min-h-screen bg-cream-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-6 py-12 lg:max-w-[1020px] lg:flex-row lg:items-center lg:justify-center lg:gap-20 lg:px-12">
        <div className="flex w-full flex-col lg:w-[380px] lg:shrink-0">
          <Card className="p-7 shadow-subtle">
            {aviso && <p role="status" className="mb-4 text-sm text-sage-600">{ENTRADA_PASSWORD_CAMBIADA}</p>}
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

              <Button
                type="submit"
                className="mt-[6px] w-full px-5 py-[13px]"
                disabled={loading}
              >
                {loading ? ENTRANDO : ENTRAR}
              </Button>
              <Link href="/recuperar" className="text-center text-sm text-sage-600 underline">{ENTRADA_OLVIDASTE}</Link>

              {/* Un solo mensaje para todos los casos: contraseña equivocada,
                  email que no existe y acceso bloqueado por intentos. El
                  porqué está escrito al lado de las constantes, en el
                  glosario. */}
              {error ? (
                <div role="alert" className="mt-2 flex flex-col gap-1">
                  <p className="text-[12px] text-[color:var(--color-error)]">
                    {ENTRADA_ERROR}
                  </p>
                  <p className="text-[11px] leading-[1.45] text-ink-500">
                    {ENTRADA_ERROR_DETALLE}
                  </p>
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
