"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MedidorAudio } from "./medidor-audio";
import { ArrowLeft, Mic, Pause, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { ConsentimientoBadge } from "@/components/grabacion/ConsentimientoBadge";
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
  nombreProfesional: string;
  direccionConsultorio: string;
  /** Consultorio creado por invitación; null en la cuenta de quien invita. */
  prueba?: EstadoPrueba | null;
}
export function GrabarView(props: Props) {
  const router = useRouter();
  const audio = useAudioGrabacion(props.cuenta, props.organizationId, props.turnoId);
  // La firma ocurre en esta misma pantalla: el prop del servidor queda viejo
  // en cuanto la paciente firma, y no hay que salir para que valga.
  const [firmadoAca, setFirmadoAca] = React.useState(false);
  const autorizada = props.autorizacionVigente || firmadoAca;
  const estado = audio.grabacion?.estado;
  const capturando = estado === "capturando";
  const cerrada = estado === "cerrada" || estado === "entregada";
  const abierta = !!audio.grabacion && !cerrada;
  useProtegerTrabajo(capturando, SALIDA_CAPTURA);
  // En el tope de la prueba no se inicia una grabación nueva; la que ya existe
  // se puede reanudar y enviar (el servidor no la vuelve a contar).
  const sinCupo = props.prueba?.restantes === 0 && !audio.grabacion;
  const rotulo = !autorizada && !capturando && !cerrada ? FALTA_AUTORIZACION : capturando ? GRABACION_ESTADOS.capturando : estado === "entregada" ? GRABACION_ESTADOS.entregada : estado === "cerrada" ? GRABACION_ESTADOS.cerrada : audio.grabacion ? GRABACION_ESTADOS.pausada : GRABACION_ESTADOS.preparada;
  return <section aria-label={GRABACION_ROTULO} className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-6 sm:px-6">
    <Link className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-sage-700 hover:underline" href={`/pacientes/${props.pacienteId}`}><ArrowLeft size={16} aria-hidden="true" />Volver a la ficha</Link>
    <AvisoPrueba prueba={props.prueba ?? null} />
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-sage-700">{GRABACION_ROTULO}</p><h1 className="font-display text-3xl leading-tight text-ink-900">{props.pacienteNombre}</h1>{props.horaTexto && <p className="mt-2 text-sm text-ink-500">{props.horaTexto}</p>}</header>
    {/* La autorización se firma acá, sin salir de la grabación. El componente
        se borra solo en cuanto está vigente. */}
    <ConsentimientoBadge
      variante="aviso"
      pacienteId={props.pacienteId}
      nombrePaciente={props.pacienteNombre}
      nombreProfesional={props.nombreProfesional}
      direccionConsultorio={props.direccionConsultorio}
      onCambio={() => { setFirmadoAca(true); router.refresh(); }}
    />
    <section className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white shadow-subtle">
    <div className={`h-1 transition-colors duration-[var(--duration-fast)] ${capturando ? "bg-sage-500" : "bg-sage-200"}`} />
    <div className="flex flex-col gap-5 p-5 sm:p-7">
    {!audio.lista && !audio.error && <p role="status">{PREPARANDO_GRABACION}</p>}
    {audio.lista && <p className="flex items-center gap-2 text-sm font-semibold text-sage-700" role="status">{capturando ? <Mic size={16} aria-hidden="true" /> : estado === "entregada" ? <Check size={16} aria-hidden="true" /> : audio.grabacion ? <Pause size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}{rotulo}</p>}
    <p className="font-display text-6xl font-medium tabular-nums tracking-tight text-ink-900" aria-label="Duración grabada">{formatearDuracion(audio.segundos)}</p>
    {/* El medidor acompaña toda la grabación, no sólo la captura: con la
        grabación en pausa sigue a la vista, diciendo que está en pausa. */}
    {abierta && <MedidorAudio nivel={audio.nivelAudio ?? null} silencioso={audio.silencioso} capturando={capturando} />}
    {audio.segundos >= AVISO_LIMITE_SEGUNDOS && !cerrada && <p role="status">{audio.segundos >= LIMITE_SEGUNDOS ? "Llegaste al límite. Elegí Terminar para procesar lo guardado." : "Llevás 135 minutos. La captura se pausará al llegar a 150."}</p>}
    {/* Un solo aviso a la vez: el último. La falla tapa al aviso, nunca se apilan. */}
    {audio.error
      ? <div role="alert" className="space-y-3 rounded-md border border-terracotta-500/30 bg-terracotta-50 p-4 text-sm text-ink-900">
          <p>{audio.error}</p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={audio.ocupada} onClick={() => void audio.reenviar()}>Comprobar y reintentar envío</Button>
            {audio.desacuerdo && <Button variant="secondary" disabled={audio.ocupada} onClick={() => void audio.apartarCopia()}>Conservar esta copia y liberar el turno</Button>}
          </div>
        </div>
      : audio.mensaje && <p role="status" aria-live="polite">{audio.mensaje}</p>}
    <div className="flex flex-wrap gap-3">
      {!cerrada && !capturando && <Button disabled={!audio.lista || audio.ocupada || !autorizada || sinCupo || audio.segundos >= LIMITE_SEGUNDOS} onClick={() => void audio.iniciar()}>{audio.grabacion ? "Reanudar grabación" : "Grabar sesión"}</Button>}
      {capturando && <Button disabled={audio.ocupada} onClick={() => void audio.pausar()}>Pausar</Button>}
      {audio.grabacion && !cerrada && <Button variant="secondary" disabled={audio.ocupada} onClick={() => void audio.terminar()}>Terminar y enviar</Button>}
      {estado === "cerrada" && <Button disabled={audio.ocupada} onClick={() => void audio.reenviar()}>Enviar grabación pendiente</Button>}
      {estado === "entregada" && <Link href={`/sesiones/${audio.grabacion!.sesionId}`}>Ver la sesión</Link>}
    </div>
    </div></section>
    <p className="flex items-start gap-3 text-sm leading-relaxed text-ink-500"><ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Podés bloquear la pantalla: la grabación sigue y cada segundo queda guardado cifrado. Al volver, mirá el medidor para confirmar que entra sonido.</span></p>
  </section>;
}
