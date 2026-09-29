"use client";
import * as React from "react";
import { Button, Input } from "@/components/ui";
import { useEnvio } from "@/hooks/useEnvio";
import { apiPost } from "@/lib/api-client";
import { ENTRADA_EMAIL, ENTRADA_RECUPERAR, ENTRADA_RECUPERAR_BOTON, ENTRADA_RECUPERAR_ENVIADO, ENTRADA_CUENTA_ERROR, GUARDANDO } from "@/lib/glosario";
import { EntradaMarco } from "../_components/entrada-marco";

export default function RecuperarPage() {
  const [email, setEmail] = React.useState("");
  const [enviado, setEnviado] = React.useState(false);
  // Siempre el mismo error: la pantalla no confirma si el email existe.
  const { enviar: pedir, enviando, error } = useEnvio(
    async () => {
      await apiPost("/api/cuenta/recuperar", { email });
      setEnviado(true);
    },
    ENTRADA_CUENTA_ERROR,
    () => ENTRADA_CUENTA_ERROR,
  );
  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    await pedir();
  }
  return <EntradaMarco titulo={ENTRADA_RECUPERAR}>
    {enviado ? <p role="status">{ENTRADA_RECUPERAR_ENVIADO}</p> : <form onSubmit={enviar} className="flex flex-col gap-4">
      <Input label={ENTRADA_EMAIL} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={enviando} />
      <Button type="submit" disabled={enviando}>{enviando ? GUARDANDO : ENTRADA_RECUPERAR_BOTON}</Button>
      {error && <p role="alert">{error}</p>}
    </form>}
  </EntradaMarco>;
}
