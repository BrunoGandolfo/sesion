"use client";
import * as React from "react";
import { Button, Card } from "@/components/ui";
import { useEnvio } from "@/hooks/useEnvio";
import { apiGet, apiPost } from "@/lib/api-client";
import { INVITAR_COLEGA, INVITAR_DESCRIPCION, INVITAR_LIMITES, INVITAR_RESTANTES, INVITAR_GENERAR, INVITAR_COPIAR, INVITAR_COPIADO, INVITAR_WHATSAPP, INVITAR_MENSAJE, INVITAR_ENLACE, INVITAR_ERROR_COPIA, ENTRADA_CUENTA_ERROR, GUARDANDO } from "@/lib/glosario";
import { TituloSeccion } from "./titulo-seccion";
type Cupo = { restantes: number; aviso: string | null };
export function InvitarColega() {
  const [enlace, setEnlace] = React.useState("");
  const [copiado, setCopiado] = React.useState(false);
  // Antes de generar: cuántas quedan y, si hoy no se puede, desde cuándo sí.
  const [cupo, setCupo] = React.useState<Cupo | null>(null);
  const leerCupo = React.useCallback(() => apiGet<Cupo>("/api/cuenta/invitaciones").then(setCupo).catch(() => setCupo(null)), []);
  React.useEffect(() => { void leerCupo(); }, [leerCupo]);
  // 403 (esta cuenta no invita) y 429 (sin cupo) traen su motivo.
  const { enviar: crear, enviando: creando, error, setError } = useEnvio(async () => {
    const datos = await apiPost<{ enlace: string }>("/api/cuenta/invitaciones", {});
    setEnlace(datos.enlace);
  }, ENTRADA_CUENTA_ERROR);
  async function generar() {
    setCopiado(false);
    await crear();
    void leerCupo();
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setError(""); }
    catch { setError(INVITAR_ERROR_COPIA); }
  }
  return <section>
    <TituloSeccion>{INVITAR_COLEGA}</TituloSeccion>
    <Card className="p-5">
      <p className="mb-2 text-sm text-ink-500">{INVITAR_DESCRIPCION}</p>
      <p className="mb-4 text-sm text-ink-500">{INVITAR_LIMITES}{cupo && ` ${INVITAR_RESTANTES(cupo.restantes)}`}</p>
      {cupo?.aviso && !error && <p role="status" className="mb-4 text-sm font-semibold text-ink-900">{cupo.aviso}</p>}
      <Button type="button" disabled={creando || Boolean(cupo?.aviso)} onClick={() => void generar()}>{creando ? GUARDANDO : INVITAR_GENERAR}</Button>
      {enlace && <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm">{INVITAR_ENLACE}<input readOnly value={enlace} onFocus={e => e.target.select()} className="mt-1 w-full rounded border border-[color:var(--border-control)] p-2 text-sm" /></label>
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
