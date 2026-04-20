"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
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
    <main className="flex min-h-screen items-center justify-center bg-cream-50 p-6">
      <div className="flex w-full flex-col items-center text-center">
        <div className="flex items-baseline justify-center gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[34px] font-medium leading-none tracking-[-0.015em] text-ink-900">
            Mariana
          </h1>
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-sage-500"
          />
        </div>

        <p className="mt-3 text-[14px] italic text-ink-500">
          Tu consulta, organizada.
        </p>

        <Card className="mt-8 w-full max-w-[380px] p-7 text-left shadow-subtle">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              disabled={loading}
              required
            />
            <Input
              label="Contraseña"
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
              {loading ? "Entrando…" : "Entrar"}
            </Button>

            {error ? (
              <p
                role="alert"
                className="mt-2 text-[12px] text-[color:var(--color-error)]"
              >
                Email o contraseña incorrectos
              </p>
            ) : null}
          </form>
        </Card>

        <p className="mt-6 text-[11px] text-ink-300">
          v1.0 · hecho con cuidado
        </p>
      </div>
    </main>
  );
}
