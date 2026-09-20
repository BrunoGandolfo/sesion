"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { apiGet, apiPost, ApiClientError, esAbort } from "@/lib/api-client";
import { formatearFechaCompletaMvd, formatearHoraMvd } from "@/lib/fechas-montevideo";
import { contenidoHiloSchema, hiloVacio, type ContenidoHilo, type Recorrido, type VersionHilo } from "@/lib/hilo/contenido";
import { HiloContenido, ORDEN_PANTALLA } from "./HiloContenido";
import { HiloEditor } from "./HiloEditor";
import { useProtegerTrabajo, useSalidaProtegida } from "@/components/layout/proteccion-trabajo";
import { SALIDA_RECORRIDO, DESCARTAR_BORRADOR, DESCARTAR_PROPUESTA, DESCARTAR_BORRADOR_ACCION } from "@/lib/glosario";

type Borrador = { basadaEnVersion: number; contenido: ContenidoHilo; propuestaId?: string };
const fecha = (iso: string) => `${formatearFechaCompletaMvd(new Date(iso))}, ${formatearHoraMvd(new Date(iso))}`;
const mensaje = (e: unknown) => e instanceof Error ? e.message : "No pudimos cargar el Recorrido. Probá de nuevo.";

// El orden de la pantalla: la versión vigente (lo que el Recorrido tiene y la
// lista de sesiones no), lo que está por resolverse —propuestas y tu borrador—,
// los indicadores que le pasa la pestaña, y al final, aparte, el historial.
export function HiloView({ pacienteId, indicadores }: { pacienteId: string; indicadores?: ReactNode }) {
  const url = `/api/pacientes/${pacienteId}/hilo`;
  const [datos, setDatos] = useState<Recorrido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [comparar, setComparar] = useState(false);
  const [historica, setHistorica] = useState<VersionHilo | null>(null);
  useProtegerTrabajo(borrador !== null, SALIDA_RECORRIDO);
  // El editor se abre debajo de la versión vigente, fuera de la vista de
  // quien tocó "Editar" arriba o "Usar como borrador" abajo: se la lleva ahí.
  const editorRef = useRef<HTMLDivElement>(null);
  const editando = borrador !== null;
  useEffect(() => { if (editando) editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [editando]);
  const confirmarSalida = useSalidaProtegida();
  const cargar = useCallback(async (signal?: AbortSignal) => {
    const r = await apiGet<Recorrido>(url, { signal });
    if (!signal?.aborted) setDatos(r);
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<Recorrido>(url, { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setDatos(r); })
      .catch(e => { if (!esAbort(e)) setError(mensaje(e)); });
    return () => controller.abort();
  }, [url]);
  const esperando = datos?.trabajos.some(t => t.estado !== "fallido");
  useEffect(() => {
    if (!esperando) return;
    const controller = new AbortController();
    const id = setInterval(() => cargar(controller.signal).catch(e => { if (!esAbort(e)) setError(mensaje(e)); }), 12_000);
    return () => { clearInterval(id); controller.abort(); };
  }, [esperando, cargar]);

  async function accion(ruta: string, cuerpo: unknown) {
    setOcupado(true); setError(null);
    try {
      await apiPost(`${url}${ruta}`, cuerpo);
      setBorrador(null); setConflicto(false); setComparar(false); setHistorica(null);
      await cargar();
    } catch (e) {
      setError(mensaje(e));
      if (e instanceof ApiClientError && e.status === 409) {
        setConflicto(true);
        try { await cargar(); } catch { /* Se conserva el borrador y el error original. */ }
      }
    } finally { setOcupado(false); }
  }
  async function ver(version: number) {
    setOcupado(true); setError(null);
    try { setHistorica(await apiGet<VersionHilo>(`${url}/versiones/${version}`)); }
    catch (e) { setError(mensaje(e)); }
    finally { setOcupado(false); }
  }
  async function masHistoria() {
    if (!datos?.historial.length) return;
    setOcupado(true);
    try {
      const r = await apiGet<Pick<Recorrido, "historial" | "hayMas">>(`${url}/versiones?antes=${datos.historial.at(-1)!.version}`);
      setDatos(actual => actual ? { ...actual, historial: [...actual.historial, ...r.historial.filter(v => !actual.historial.some(x => x.id === v.id))], hayMas: r.hayMas } : actual);
    } catch (e) { setError(mensaje(e)); }
    finally { setOcupado(false); }
  }
  const vigente = datos?.vigente;
  const base = vigente?.version ?? 0;
  const propuesta = datos?.propuesta;
  const editar = (contenido: ContenidoHilo, propuestaId?: string) => { setBorrador({ basadaEnVersion: base, contenido: structuredClone(contenido), propuestaId }); setConflicto(false); setError(null); };
  function guardar() {
    if (!borrador || conflicto) return;
    const validacion = contenidoHiloSchema.safeParse(borrador.contenido);
    if (!validacion.success) { setError("Revisá los campos: las descripciones no pueden estar vacías y las fechas y cantidades deben ser válidas."); return; }
    void accion(borrador.propuestaId ? `/propuestas/${borrador.propuestaId}/aceptar` : "/versiones", { basadaEnVersion: borrador.basadaEnVersion, contenido: validacion.data });
  }
  return <div className="space-y-6">
    {error ? <div role="alert" className="rounded-md border border-terracotta-500/30 p-4"><p>{error}</p>{!datos ? <Button onClick={() => cargar().then(() => setError(null)).catch(e => setError(mensaje(e)))}>Volver a intentar</Button> : null}</div> : null}
    {!datos ? (!error ? <p role="status">Cargando Recorrido…</p> : null) : <>
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-2xl">El Recorrido</h3>
          <p className="mt-1 text-sm text-ink-500">{vigente ? `${vigente.actor === "ia" ? "Propuesta aceptada" : "Revisado por vos"} el ${fecha(vigente.resueltaEn ?? vigente.creadaEn)}` : "Todavía no hay un Recorrido revisado."}</p></div>
          <Button variant="secondary" disabled={ocupado || !!borrador} onClick={() => editar(vigente?.contenido ?? hiloVacio())}>Editar Recorrido</Button>
        </div>
        {vigente ? <HiloContenido pantalla contenido={vigente.contenido} sesiones={datos.sesionesAprobadas} /> : <p>Podés escribirlo o esperar una propuesta después de aprobar una nota.</p>}
      </Card>
      {propuesta ? <Card className="space-y-4 border-sage-200 p-5">
        <h3 className="font-semibold">Hay una propuesta nueva</h3>
        <p className="text-sm">La IA la preparó a partir de una nota aprobada. Se incorpora al Recorrido cuando vos la aceptás.</p>
        {propuesta.sesionOrigenId ? <Link className="underline" href={`/sesiones/${propuesta.sesionOrigenId}`}>Ver nota de origen</Link> : null}
        <ul className="list-inside list-disc">{propuesta.contenido.cambios.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <Button variant="secondary" onClick={() => setComparar(!comparar)}>{comparar ? "Cerrar comparación" : "Ver propuesta"}</Button>
        {comparar ? <div className="space-y-5">{ORDEN_PANTALLA.map(campo => <div key={campo} className="grid gap-4 border-t border-[color:var(--border-subtle)] pt-4 md:grid-cols-2">
          <section><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Vigente</p><HiloContenido pantalla solo={campo} contenido={vigente?.contenido ?? hiloVacio()} sesiones={datos.sesionesAprobadas} /></section>
          <section className="rounded-md bg-sage-50 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sage-700">Propuesta</p><HiloContenido pantalla solo={campo} contenido={propuesta.contenido} anterior={vigente?.contenido ?? hiloVacio()} sesiones={datos.sesionesAprobadas} /></section>
        </div>)}</div> : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={ocupado || !!borrador} onClick={() => accion(`/propuestas/${propuesta.id}/aceptar`, { basadaEnVersion: base })}>Aceptar</Button>
          <Button variant="secondary" disabled={ocupado || !!borrador} onClick={() => editar(propuesta.contenido, propuesta.id)}>Editar y aceptar</Button>
          <Button variant="ghost" disabled={ocupado || !!borrador} onClick={() => confirmarSalida(() => void accion(`/propuestas/${propuesta.id}/rechazar`, { basadaEnVersion: base }), { mensaje: DESCARTAR_PROPUESTA, etiqueta: "Descartar propuesta" })}>Descartar propuesta</Button>
        </div>
      </Card> : null}
      {datos.desactualizadas.map(p => <Card key={p.id} className="space-y-3 p-4"><h3 className="font-semibold">Hay una propuesta vieja: el Recorrido cambió después</h3><div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={ocupado} onClick={() => ver(p.version)}>Ver propuesta vieja</Button>
        <Button variant="ghost" disabled={ocupado || !!borrador} onClick={() => confirmarSalida(() => void accion(`/propuestas/${p.id}/rechazar`, { basadaEnVersion: base }), { mensaje: DESCARTAR_PROPUESTA, etiqueta: "Descartar propuesta" })}>Descartar</Button>
        <Button variant="secondary" disabled={ocupado || !!borrador} onClick={() => accion("/regenerar", { basadaEnVersion: base, propuestaId: p.id })}>Volver a generar sobre el Recorrido actual</Button>
      </div></Card>)}
      {datos.trabajos.map(t => <p key={t.id} className="text-sm" role="status">{t.estado === "fallido" ? <>No se pudo preparar una propuesta. <Button variant="ghost" disabled={ocupado || !!borrador} onClick={() => accion("/regenerar", { basadaEnVersion: base, trabajoId: t.id })}>Volver a intentar</Button></> : propuesta ? "Hay otra sesión esperando que resuelvas la propuesta anterior." : "Preparando una propuesta…"}{t.sesionId ? <> <Link className="underline" href={`/sesiones/${t.sesionId}`}>Ver sesión</Link></> : null}</p>)}
      {borrador ? <div ref={editorRef} className="scroll-mt-4"><Card className="space-y-4 p-5">
        <h3 className="font-semibold">{borrador.propuestaId ? "Editar propuesta" : "Tu edición del Recorrido"}</h3>
        <p className="text-sm">Al guardar se agrega una versión; las anteriores se conservan.</p>
        {propuesta && !borrador.propuestaId ? <p>Guardar tu edición dejará desactualizada la propuesta abierta.</p> : null}
        {conflicto ? <div role="alert"><p>El Recorrido cambió en otra pantalla. Tu borrador se conserva abajo. Revisá la versión vigente antes de continuar.</p><Button variant="secondary" onClick={() => { setBorrador({ ...borrador, basadaEnVersion: base, propuestaId: undefined }); setConflicto(false); }}>Ya leí la versión actual; continuar con mi borrador</Button></div> : null}
        <HiloEditor valor={borrador.contenido} cambiar={contenido => setBorrador({ ...borrador, contenido })} disabled={ocupado} sesiones={datos.sesionesAprobadas} />
        <div className="flex flex-wrap gap-3"><Button disabled={ocupado || conflicto} onClick={guardar}>{borrador.propuestaId ? "Guardar y aceptar" : "Guardar nueva versión"}</Button><Button variant="ghost" disabled={ocupado} onClick={() => confirmarSalida(() => setBorrador(null), { mensaje: DESCARTAR_BORRADOR, etiqueta: DESCARTAR_BORRADOR_ACCION })}>Cancelar edición</Button></div>
      </Card></div> : null}
    </>}
    {indicadores}
    {datos ? <>
      <details className="rounded-md border border-[color:var(--border-subtle)] px-4 py-1.5"><summary className="cursor-pointer py-2.5 font-semibold">Historial de versiones ({datos.historial.length}{datos.hayMas ? "+" : ""})</summary>
        <ul className="mt-4 space-y-3">{datos.historial.map(v => <li key={v.id}><Button variant="ghost" disabled={ocupado} onClick={() => ver(v.version)}>Versión {v.version} · {v.actor === "ia" ? "Propuesta de IA" : "Edición profesional"} · {v.estado}</Button><p className="text-xs text-ink-500">{fecha(v.creadaEn)}{v.resueltaEn ? ` · Resuelta el ${fecha(v.resueltaEn)}` : ""}</p></li>)}</ul>
        {datos.hayMas ? <Button variant="secondary" disabled={ocupado} onClick={masHistoria}>Ver versiones anteriores</Button> : null}
      </details>
      {historica ? <Card className="space-y-4 p-5"><h3 className="font-semibold">Versión {historica.version} · {historica.estado}</h3><HiloContenido pantalla contenido={historica.contenido} sesiones={datos.sesionesAprobadas} />
        <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={ocupado || !!borrador} onClick={() => editar(historica.contenido)}>Usar como borrador de una versión nueva</Button>
          {historica.actor === "ia" && historica.estado === "rechazada" && historica.sesionOrigenId ? <Button variant="secondary" disabled={ocupado || !!borrador} onClick={() => accion("/regenerar", { basadaEnVersion: base, propuestaId: historica.id })}>Volver a generar propuesta</Button> : null}
          <Button variant="ghost" onClick={() => setHistorica(null)}>Cerrar versión</Button></div>
      </Card> : null}
    </> : null}
  </div>;
}
