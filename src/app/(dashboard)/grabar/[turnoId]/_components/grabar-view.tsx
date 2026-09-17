"use client";
import Link from "next/link";
import { ArrowLeft, Mic, Pause, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useAudioGrabacion } from "@/hooks/useAudioGrabacion";
import { AVISO_LIMITE_SEGUNDOS, LIMITE_SEGUNDOS, formatearDuracion } from "@/lib/audio/contrato";
import { AvisoPrueba } from "@/components/layout/aviso-prueba";
import { useProtegerTrabajo } from "@/components/layout/proteccion-trabajo";
import type { EstadoPrueba } from "@/lib/limites-prueba";
import { SALIDA_CAPTURA, PREPARANDO_GRABACION, GRABACION_ROTULO, GRABACION_ESTADOS, FALTA_AUTORIZACION } from "@/lib/glosario";

interface Props {
  turnoId: string;
  cuenta: string;
  organizationId: string;
  horaTexto: string | null;
  pacienteId: string;
  pacienteNombre: string;
  autorizacionVigente: boolean;
  /** Consultorio creado por invitación; null en la cuenta de quien invita. */
  prueba?: EstadoPrueba | null;
}
export function GrabarView(props: Props) {
  const audio = useAudioGrabacion(props.cuenta, props.organizationId, props.turnoId);
  const estado = audio.grabacion?.estado;
  const capturando = estado === "capturando";
  const cerrada = estado === "cerrada" || estado === "entregada";
  useProtegerTrabajo(capturando, SALIDA_CAPTURA);
  // En el tope de la prueba no se inicia una grabación nueva; la que ya existe
  // se puede reanudar y enviar (el servidor no la vuelve a contar).
  const sinCupo = props.prueba?.restantes === 0 && !audio.grabacion;
  const rotulo = !props.autorizacionVigente && !capturando && !cerrada ? FALTA_AUTORIZACION : capturando ? GRABACION_ESTADOS.capturando : estado === "entregada" ? GRABACION_ESTADOS.entregada : estado === "cerrada" ? GRABACION_ESTADOS.cerrada : audio.grabacion ? GRABACION_ESTADOS.pausada : GRABACION_ESTADOS.preparada;
  return <section aria-label={GRABACION_ROTULO} className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-6 sm:px-6">
    <Link className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-sage-700 hover:underline" href={`/pacientes/${props.pacienteId}`}><ArrowLeft size={16} aria-hidden="true" />Volver a la ficha</Link>
    <AvisoPrueba prueba={props.prueba ?? null} />
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-sage-700">{GRABACION_ROTULO}</p><h1 className="font-display text-3xl leading-tight text-ink-900">{props.pacienteNombre}</h1>{props.horaTexto && <p className="mt-2 text-sm text-ink-500">{props.horaTexto}</p>}</header>
    <section className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white shadow-subtle">
    <div className={`h-1 transition-colors duration-[var(--duration-fast)] ${capturando ? "bg-sage-500" : "bg-sage-200"}`} />
    <div className="flex flex-col gap-5 p-5 sm:p-7">
    {!props.autorizacionVigente && <p>Para iniciar o reanudar necesitás la autorización vigente de la paciente.</p>}
    {!audio.lista && !audio.error && <p role="status">{PREPARANDO_GRABACION}</p>}
    {audio.lista && <p className="flex items-center gap-2 text-sm font-semibold text-sage-700" role="status">{capturando ? <Mic size={16} aria-hidden="true" /> : estado === "entregada" ? <Check size={16} aria-hidden="true" /> : audio.grabacion ? <Pause size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}{rotulo}</p>}
    <p className="font-display text-6xl font-medium tabular-nums tracking-tight text-ink-900" aria-label="Duración grabada">{formatearDuracion(audio.segundos)}</p>
    {audio.grabacion && !capturando && !cerrada && <p>Hay una grabación de este turno. Podés recuperar y enviar lo guardado o reanudarla.</p>}
    {audio.segundos >= AVISO_LIMITE_SEGUNDOS && !cerrada && <p role="status">{audio.segundos >= LIMITE_SEGUNDOS ? "Llegaste al límite. Elegí Terminar para procesar lo guardado." : "Llevás 135 minutos. La captura se pausará al llegar a 150."}</p>}
    {audio.mensaje && <p role="status" aria-live="polite">{audio.mensaje}</p>}
    {audio.error && <div role="alert" className="space-y-3 rounded-md border border-terracotta-500/30 bg-terracotta-50 p-4 text-sm text-ink-900"><p>{audio.error}</p><Button onClick={() => void audio.reenviar()}>Comprobar y reintentar envío</Button></div>}
    <div className="flex flex-wrap gap-3">
      {audio.ausenteRemoto && <Button disabled={audio.ocupada} onClick={() => void audio.archivarAusente()}>Conservar copia y habilitar otra grabación</Button>}
      {!cerrada && !capturando && <Button disabled={!audio.lista || audio.ocupada || !props.autorizacionVigente || sinCupo || audio.segundos >= LIMITE_SEGUNDOS} onClick={() => void audio.iniciar()}>{audio.grabacion ? "Reanudar grabación" : "Grabar sesión"}</Button>}
      {capturando && <Button disabled={audio.ocupada} onClick={() => void audio.pausar()}>Pausar</Button>}
      {audio.grabacion && !cerrada && <Button variant="secondary" disabled={audio.ocupada} onClick={() => void audio.terminar()}>Terminar y enviar</Button>}
      {estado === "cerrada" && <Button disabled={audio.ocupada} onClick={() => void audio.reenviar()}>Enviar grabación pendiente</Button>}
      {estado === "entregada" && <Link href={`/sesiones/${audio.grabacion!.sesionId}`}>Ver la sesión</Link>}
    </div>
    </div></section>
    <p className="flex items-start gap-3 text-sm leading-relaxed text-ink-500"><ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Mantené la pantalla encendida. Si se bloquea o se interrumpe el micrófono, el tramo puede quedar incompleto y habrá que reanudar.</span></p>
  </section>;
}
