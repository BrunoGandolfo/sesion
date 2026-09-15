"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { useAudioGrabacion } from "@/hooks/useAudioGrabacion";
import { AVISO_LIMITE_SEGUNDOS, LIMITE_SEGUNDOS, formatearDuracion } from "@/lib/audio/contrato";

interface Props {
  turnoId: string;
  cuenta: string;
  organizationId: string;
  horaTexto: string | null;
  pacienteId: string;
  pacienteNombre: string;
  autorizacionVigente: boolean;
}
export function GrabarView(props: Props) {
  const audio = useAudioGrabacion(props.cuenta, props.organizationId, props.turnoId);
  const estado = audio.grabacion?.estado;
  const capturando = estado === "capturando";
  const cerrada = estado === "cerrada" || estado === "entregada";
  return <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
    <Link href={`/pacientes/${props.pacienteId}`}>Volver a la ficha</Link>
    <header><h1 className="text-2xl font-semibold">{props.pacienteNombre}</h1>{props.horaTexto && <p>{props.horaTexto}</p>}</header>
    {!props.autorizacionVigente && <p>Para iniciar o reanudar necesitás la autorización vigente de la paciente.</p>}
    <p className="text-5xl tabular-nums" aria-label="Duración grabada">{formatearDuracion(audio.segundos)}</p>
    {audio.grabacion && !capturando && !cerrada && <p>Hay una grabación de este turno. Podés recuperar y enviar lo guardado o reanudarla.</p>}
    {audio.segundos >= AVISO_LIMITE_SEGUNDOS && !cerrada && <p role="status">{audio.segundos >= LIMITE_SEGUNDOS ? "Llegaste al límite. Elegí Terminar para procesar lo guardado." : "Llevás 135 minutos. La captura se pausará al llegar a 150."}</p>}
    {audio.mensaje && <p role="status" aria-live="polite">{audio.mensaje}</p>}
    {audio.error && <div role="alert"><p>{audio.error}</p><Button onClick={() => void audio.reenviar()}>Comprobar y reintentar envío</Button></div>}
    <div className="flex flex-wrap gap-3">
      {audio.ausenteRemoto && <Button disabled={audio.ocupada} onClick={() => void audio.archivarAusente()}>Conservar copia y habilitar otra grabación</Button>}
      {!cerrada && !capturando && <Button disabled={!audio.lista || audio.ocupada || !props.autorizacionVigente || audio.segundos >= LIMITE_SEGUNDOS} onClick={() => void audio.iniciar()}>{audio.grabacion ? "Reanudar grabación" : "Grabar sesión"}</Button>}
      {capturando && <Button disabled={audio.ocupada} onClick={() => void audio.pausar()}>Pausar</Button>}
      {audio.grabacion && !cerrada && <Button disabled={audio.ocupada} onClick={() => void audio.terminar()}>Terminar y enviar</Button>}
      {estado === "cerrada" && <Button disabled={audio.ocupada} onClick={() => void audio.reenviar()}>Enviar grabación pendiente</Button>}
      {estado === "entregada" && <Link href={`/sesiones/${audio.grabacion!.sesionId}`}>Ver la sesión</Link>}
    </div>
    <p className="text-sm">Mantené la pantalla encendida. Si se bloquea o se interrumpe el micrófono, el tramo puede quedar incompleto y habrá que reanudar.</p>
  </main>;
}
