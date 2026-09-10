"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { Button, Input } from "@/components/ui";
import { ApiClientError, apiPost } from "@/lib/api-client";
import { PASSWORD_MIN, validarPasswordNueva } from "@/lib/password";
import {
  ENTRADA_REGISTRO, ENTRADA_NOMBRE, ENTRADA_EMAIL, ENTRADA_CONTRASENA, ENTRADA_REPETIR,
  ENTRADA_ACEPTA_TERMINOS, ENTRADA_TERMINOS_REQUERIDOS, ENTRADA_INVITACION_INVALIDA,
  ENTRADA_PEDIR_INVITACION, ENTRADA_PASSWORD_NO_COINCIDE, ENTRADA_CUENTA_ERROR,
  ENTRADA_CUENTA_CREADA_SIN_SESION, GUARDANDO,
} from "@/lib/glosario";
import { EntradaMarco } from "../_components/entrada-marco";

export function RegistroForm({ token, valida }: { token: string; valida: boolean }) {
  const router = useRouter();
  const [nombre, setNombre] = React.useState(""); const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState(""); const [repetida, setRepetida] = React.useState("");
  const [acepta, setAcepta] = React.useState(false); const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState(""); const [creada, setCreada] = React.useState(false);
  async function enviar(evento: React.FormEvent) {
    evento.preventDefault(); if (enviando || creada) return;
    if (!acepta) { setError(ENTRADA_TERMINOS_REQUERIDOS); return; }
    const validacion = validarPasswordNueva(password);
    if (!validacion.ok) { setError(validacion.motivo); return; }
    if (password !== repetida) { setError(ENTRADA_PASSWORD_NO_COINCIDE); return; }
    setEnviando(true); setError("");
    let cuentaCreada = false;
    try {
      await apiPost("/api/cuenta/registro", { token, nombre, email, password, aceptaTerminos: true });
      cuentaCreada = true; setCreada(true);
      await signOut({ redirect: false });
      const resultado = await signIn("credentials", { email: email.trim().toLowerCase(), password, redirect: false });
      if (resultado?.ok && !resultado.error) { router.replace("/"); router.refresh(); }
      else setError(ENTRADA_CUENTA_CREADA_SIN_SESION);
    } catch (e) { setError(cuentaCreada ? ENTRADA_CUENTA_CREADA_SIN_SESION : e instanceof ApiClientError ? e.message : ENTRADA_CUENTA_ERROR); }
    finally { setEnviando(false); }
  }
  return <EntradaMarco titulo={ENTRADA_REGISTRO}>
    {!valida ? <div role="alert"><p>{ENTRADA_INVITACION_INVALIDA}</p><p className="mt-2">{ENTRADA_PEDIR_INVITACION}</p></div>
      : creada ? (error ? <p role="status">{error}</p> : <p role="status">{GUARDANDO}</p>)
      : <form onSubmit={enviar} className="flex flex-col gap-4">
        <Input label={ENTRADA_NOMBRE} autoComplete="name" required maxLength={120} value={nombre} onChange={e => setNombre(e.target.value)} disabled={enviando} />
        <Input label={ENTRADA_EMAIL} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={enviando} />
        <Input label={ENTRADA_CONTRASENA} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={password} onChange={e => setPassword(e.target.value)} disabled={enviando} />
        <Input label={ENTRADA_REPETIR} type="password" autoComplete="new-password" required value={repetida} onChange={e => setRepetida(e.target.value)} disabled={enviando} />
        <div className="flex items-start gap-2 text-sm text-ink-700">
          <input id="acepta-terminos" type="checkbox" required checked={acepta} onChange={e => setAcepta(e.target.checked)} disabled={enviando} className="mt-1" />
          <label htmlFor="acepta-terminos"><Link href="/terminos" target="_blank" rel="noopener noreferrer" className="underline">{ENTRADA_ACEPTA_TERMINOS}</Link></label>
        </div>
        <Button type="submit" disabled={enviando}>{enviando ? GUARDANDO : ENTRADA_REGISTRO}</Button>
        {error && <p role="alert">{error}</p>}
      </form>}
  </EntradaMarco>;
}
