// Arnés mínimo para probar en un navegador de verdad el hook REAL del grabador
// y la subida REAL (src/hooks/useGrabacionSesion.ts: subirAudio). No es la
// pantalla de la app: son cuatro botones y el estado, para que Playwright
// toque lo mismo que toca la profesional. La API es local (verificar.mjs).
import * as React from "react";
import { createRoot } from "react-dom/client";

import { useGrabador, type DatosGrabacion } from "@/components/grabacion/GrabadorSesion";
import { subirAudio } from "@/hooks/useGrabacionSesion";

declare global {
  interface Window {
    subida: { estado: "no" | "subiendo" | "lista" | "fallo"; progreso: number; datos?: Omit<DatosGrabacion, "audioBlob"> & { bytes: number; tipo: string }; error?: string };
    simularDosHoras: () => Promise<{ bytes: number; mayorTrabaMs: number; heapAntesMB: number | null; heapPicoMB: number | null; ms: number }>;
  }
}

window.subida = { estado: "no", progreso: 0 };

/** El Blob de una sesión de dos horas: 7200 trozos de ~16 KB, como los reales. */
window.simularDosHoras = async () => {
  const trozos: Blob[] = [];
  for (let i = 0; i < 7200; i += 1) trozos.push(new Blob([crypto.getRandomValues(new Uint8Array(16_384))]));
  const audioBlob = new Blob(trozos, { type: "audio/webm;codecs=opus" });
  const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
  const heapAntes = heap();
  let pico = heapAntes;
  let mayorTraba = 0;
  let ultimo = performance.now();
  const vigia = setInterval(() => {
    const ahora = performance.now();
    mayorTraba = Math.max(mayorTraba, ahora - ultimo - 50);
    ultimo = ahora;
    const h = heap();
    if (h !== null && (pico === null || h > pico)) pico = h;
  }, 50);
  const inicio = performance.now();
  await subirAudio("dos-horas", { audioBlob, duracionSegundos: 7200, pausas: [], diagnostico: { eventos: [], chunks: 7200, bytes: audioBlob.size } });
  clearInterval(vigia);
  const mb = (n: number | null) => (n === null ? null : Math.round(n / 1_048_576));
  return { bytes: audioBlob.size, mayorTrabaMs: Math.round(mayorTraba), heapAntesMB: mb(heapAntes), heapPicoMB: mb(pico), ms: Math.round(performance.now() - inicio) };
};

function Arnes() {
  const grabador = useGrabador({
    claveGrabacion: "turno-arnes",
    onListo: (datos) => {
      const { audioBlob, ...resto } = datos;
      window.subida = { estado: "subiendo", progreso: 0, datos: { ...resto, bytes: audioBlob.size, tipo: audioBlob.type } };
      subirAudio("sesion-arnes", datos, (p) => { window.subida.progreso = p; }).then(
        () => { window.subida.estado = "lista"; },
        (e: unknown) => { window.subida.estado = "fallo"; window.subida.error = String(e); },
      );
    },
    onError: (mensaje) => { window.subida = { estado: "fallo", progreso: 0, error: mensaje }; },
  });
  const { estado, segundos, hueco, conmutando, limiteAlcanzado, microfonoSilenciado } = grabador;
  return (
    <main>
      <button onClick={() => void grabador.iniciar("turno-arnes")}>Grabar</button>
      <button onClick={grabador.pausar} disabled={conmutando}>Pausar</button>
      <button onClick={grabador.reanudar} disabled={conmutando}>Reanudar</button>
      <button onClick={grabador.terminar}>Terminar</button>
      <pre id="vista">{JSON.stringify({ estado, segundos, hueco, conmutando, limiteAlcanzado, microfonoSilenciado })}</pre>
    </main>
  );
}

createRoot(document.getElementById("raiz")!).render(<Arnes />);
