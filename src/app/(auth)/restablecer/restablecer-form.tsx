"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { ApiClientError, apiPost } from "@/lib/api-client";
import { validarPasswordNueva, PASSWORD_MIN } from "@/lib/password";
import { TOKEN_CUENTA } from "@/lib/cuenta-tokens";
import { ENTRADA_RESTABLECER, ENTRADA_CONTRASENA, ENTRADA_REPETIR, ENTRADA_PASSWORD_NO_COINCIDE, ENTRADA_ENLACE_INVALIDO, ENTRADA_CUENTA_ERROR, GUARDANDO } from "@/lib/glosario";
import { EntradaMarco } from "../_components/entrada-marco";

export function RestablecerForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [repetida, setRepetida] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState("");
  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const validacion = validarPasswordNueva(password);
    if (!validacion.ok) { setError(validacion.motivo); return; }
    if (password !== repetida) { setError(ENTRADA_PASSWORD_NO_COINCIDE); return; }
    setEnviando(true); setError("");
    try {
      await apiPost("/api/cuenta/restablecer", { token, password });
      router.replace("/login?aviso=password-cambiada");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : ENTRADA_CUENTA_ERROR); }
    finally { setEnviando(false); }
  }
  return <EntradaMarco titulo={ENTRADA_RESTABLECER}>
    {!TOKEN_CUENTA.test(token) ? <p role="alert">{ENTRADA_ENLACE_INVALIDO}</p> : <form onSubmit={enviar} className="flex flex-col gap-4">
      <Input label={ENTRADA_CONTRASENA} type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={password} onChange={e => setPassword(e.target.value)} disabled={enviando} />
      <Input label={ENTRADA_REPETIR} type="password" autoComplete="new-password" required value={repetida} onChange={e => setRepetida(e.target.value)} disabled={enviando} />
      <Button type="submit" disabled={enviando}>{enviando ? GUARDANDO : ENTRADA_RESTABLECER}</Button>
      {error && <p role="alert">{error}</p>}
    </form>}
  </EntradaMarco>;
}
