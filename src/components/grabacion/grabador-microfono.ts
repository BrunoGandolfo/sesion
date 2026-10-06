"use client";

// El micrófono abierto de una grabación: la pista (silenciada por una
// llamada, o terminada) y el medidor de sonido. El medidor es sólo un
// medidor: pinta el nivel y avisa silencio, nunca corta nada. Lo usa
// useGrabador (GrabadorSesion.tsx), que es quien decide.

import * as React from "react";

import { SILENCIO_AVISO_SEG } from "@/lib/grabacion-captura";
import type { EventoGrabacion } from "@/lib/sesion-clinica/schema";

// Debajo de este RMS (0-1) el medidor considera que no entra sonido.
const UMBRAL_SILENCIO = 0.012;

export function useMicrofono(anotar: (tipo: EventoGrabacion["tipo"]) => void) {
  const [nivelAudio, setNivelAudio] = React.useState(0);
  const [audioSilencioso, setAudioSilencioso] = React.useState(false);
  const [microfonoSilenciado, setMicrofonoSilenciado] = React.useState(false);

  const streamRef = React.useRef<MediaStream | null>(null);
  const silencioDesdeRef = React.useRef<number | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analizadorRef = React.useRef<AnalyserNode | null>(null);

  const soltar = React.useCallback(() => {
    analizadorRef.current = null;
    silencioDesdeRef.current = null;
    const contexto = audioContextRef.current;
    audioContextRef.current = null;
    void contexto?.close().catch(() => {});

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    }
    streamRef.current = null;
  }, []);

  /** El micrófono recién abierto: queda para soltarlo después. */
  function tomar(stream: MediaStream) {
    streamRef.current = stream;
  }

  /** Escucha la pista y conecta el medidor. */
  function escuchar(stream: MediaStream, alTerminarPista: () => void) {
    const pista = stream.getAudioTracks()[0];
    if (pista) {
      pista.onended = alTerminarPista;
      // Una llamada entrante silencia la pista. El recorder sigue y graba
      // silencio: es el mismo archivo, y al cortar la llamada vuelve solo.
      pista.onmute = () => {
        anotar("mute");
        setMicrofonoSilenciado(true);
      };
      pista.onunmute = () => {
        anotar("unmute");
        setMicrofonoSilenciado(false);
      };
    }

    conectarMedidor(stream);
  }

  function conectarMedidor(stream: MediaStream) {
    const Constructor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    try {
      const contexto = new Constructor();
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      contexto.createMediaStreamSource(stream).connect(analizador);
      void contexto.resume().catch(() => {});
      audioContextRef.current = contexto;
      analizadorRef.current = analizador;
    } catch {
      // Sin medidor se graba igual.
    }
  }

  /** Sólo pinta: el nivel y el aviso visible de silencio. No decide nada. */
  function medir(ahora: number) {
    const analizador = analizadorRef.current;
    if (!analizador || audioContextRef.current?.state !== "running") {
      silencioDesdeRef.current = null;
      setAudioSilencioso(false);
      return;
    }
    const muestra = new Uint8Array(analizador.fftSize);
    analizador.getByteTimeDomainData(muestra);
    let suma = 0;
    for (const valor of muestra) suma += ((valor - 128) / 128) ** 2;
    const rms = Math.sqrt(suma / muestra.length);
    setNivelAudio(Math.min(1, rms * 6));
    silencioDesdeRef.current = rms < UMBRAL_SILENCIO ? (silencioDesdeRef.current ?? ahora) : null;
    setAudioSilencioso(
      document.visibilityState === "visible" &&
        silencioDesdeRef.current !== null &&
        ahora - silencioDesdeRef.current >= SILENCIO_AVISO_SEG * 1000,
    );
  }

  /** En pausa el medidor queda en cero y sin aviso de silencio. */
  function aquietar() {
    setNivelAudio(0);
    setAudioSilencioso(false);
  }

  /** Además, se olvida que el teléfono había silenciado el micrófono. */
  function reiniciar() {
    aquietar();
    setMicrofonoSilenciado(false);
  }

  /** Al reanudar, el silencio se vuelve a contar de cero. */
  function olvidarSilencio() {
    silencioDesdeRef.current = null;
  }

  return {
    nivelAudio,
    audioSilencioso,
    microfonoSilenciado,
    soltar,
    tomar,
    escuchar,
    medir,
    aquietar,
    reiniciar,
    olvidarSilencio,
  };
}
