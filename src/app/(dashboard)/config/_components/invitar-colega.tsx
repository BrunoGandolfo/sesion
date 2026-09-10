"use client";
import * as React from "react";
import { Button, Card } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { INVITAR_COLEGA, INVITAR_DESCRIPCION, INVITAR_GENERAR, INVITAR_COPIAR, INVITAR_COPIADO, INVITAR_WHATSAPP, INVITAR_MENSAJE, INVITAR_ENLACE, INVITAR_ERROR_COPIA, ENTRADA_CUENTA_ERROR, GUARDANDO } from "@/lib/glosario";
import { TituloSeccion } from "./titulo-seccion";
export function InvitarColega() {
  const [enlace, setEnlace] = React.useState(""); const [creando, setCreando] = React.useState(false);
  const [copiado, setCopiado] = React.useState(false); const [error, setError] = React.useState("");
  async function generar() {
    if (creando) return;
    setCreando(true); setError(""); setCopiado(false);
    try { const datos = await apiPost<{ enlace: string }>("/api/cuenta/invitaciones", {}); setEnlace(datos.enlace); }
    catch { setError(ENTRADA_CUENTA_ERROR); }
    finally { setCreando(false); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setError(""); }
    catch { setError(INVITAR_ERROR_COPIA); }
  }
  return <section>
    <TituloSeccion>{INVITAR_COLEGA}</TituloSeccion>
    <Card className="p-5">
      <p className="mb-4 text-sm text-ink-500">{INVITAR_DESCRIPCION}</p>
      <Button type="button" disabled={creando} onClick={() => void generar()}>{creando ? GUARDANDO : INVITAR_GENERAR}</Button>
      {enlace && <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm">{INVITAR_ENLACE}<input readOnly value={enlace} onFocus={e => e.target.select()} className="mt-1 w-full rounded border p-2 text-sm" /></label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void copiar()}>{INVITAR_COPIAR}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${INVITAR_MENSAJE}\n${enlace}`)}`} target="_blank" rel="noopener noreferrer" className="text-sm text-sage-600 underline">{INVITAR_WHATSAPP}</a>
        </div>
        {copiado && <p role="status" className="text-sm">{INVITAR_COPIADO}</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    </Card>
  </section>;
}
