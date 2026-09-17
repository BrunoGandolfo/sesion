"use client";
import { useEffect, useRef, useState } from "react";
import { Grabadora, type VistaGrabadora } from "@/lib/audio/grabadora";

export function useAudioGrabacion(cuenta: string, organizationId: string, turnoId: string) {
  const referencia = useRef<Grabadora | null>(null);
  const [vista, setVista] = useState<VistaGrabadora>({ lista: false, ocupada: false, grabacion: null, segundos: 0, mensaje: "", error: null, nivelAudio: null, silencioso: false });
  useEffect(() => {
    let cancelado = false;
    let grabadora: Grabadora | null = null;
    let desuscribir: (() => void) | undefined;
    void Promise.resolve().then(async () => {
      if (cancelado) return;
      grabadora = new Grabadora(cuenta, organizationId, turnoId);
      referencia.current = grabadora;
      desuscribir = grabadora.suscribir(() => setVista(grabadora!.snapshot()));
      await grabadora.abrir();
    });
    return () => { cancelado = true; desuscribir?.(); referencia.current = null; void grabadora?.cerrar(); };
  }, [cuenta, organizationId, turnoId]);
  return { ...vista, iniciar: () => referencia.current?.iniciar(), pausar: () => referencia.current?.pausar(), terminar: () => referencia.current?.terminar(), reenviar: () => referencia.current?.reintentar(), archivarAusente: () => referencia.current?.archivarAusente() };
}
