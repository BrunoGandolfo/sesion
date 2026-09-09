"use client";
import * as React from "react";
import { Button, Input } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { ENTRADA_EMAIL, ENTRADA_RECUPERAR, ENTRADA_RECUPERAR_BOTON, ENTRADA_RECUPERAR_ENVIADO, ENTRADA_CUENTA_ERROR, GUARDANDO } from "@/lib/glosario";
import { EntradaMarco } from "../_components/entrada-marco";

export default function RecuperarPage() {
  const [email, setEmail] = React.useState("");
  const [enviado, setEnviado] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState(false);
  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true); setError(false);
    try { await apiPost("/api/cuenta/recuperar", { email }); setEnviado(true); }
    catch { setError(true); }
    finally { setEnviando(false); }
  }
  return <EntradaMarco titulo={ENTRADA_RECUPERAR}>
    {enviado ? <p role="status">{ENTRADA_RECUPERAR_ENVIADO}</p> : <form onSubmit={enviar} className="flex flex-col gap-4">
      <Input label={ENTRADA_EMAIL} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={enviando} />
      <Button type="submit" disabled={enviando}>{enviando ? GUARDANDO : ENTRADA_RECUPERAR_BOTON}</Button>
      {error && <p role="alert">{ENTRADA_CUENTA_ERROR}</p>}
    </form>}
  </EntradaMarco>;
}
