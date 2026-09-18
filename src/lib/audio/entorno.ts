/** Protecciones recuperadas del grabador anterior (ea5ce74^).
 * Son independientes de las piezas: nunca deciden por visibilidad ni por
 * silencio si hay que cerrar una sesión. */
const GRACIA_MUTE_MS = 3000;
const UMBRAL_SILENCIO = 0.012;
const AVISO_SILENCIO_MS = 120_000;

/** El AudioContext del medidor, abierto aparte del resto de la captura. */
export interface MedicionAudio {
  contexto: AudioContext;
  cerrar(): void;
}

/**
 * Abre el audio del dispositivo. Hay que llamarla DENTRO del gesto que pidió
 * grabar: si se espera al permiso de micrófono o a una respuesta de red, el
 * navegador ya no considera que hubo gesto, el contexto nace suspendido y el
 * medidor no vuelve a medir en toda la sesión.
 */
export function abrirMedicion(): MedicionAudio | null {
  const Constructor = typeof window === "undefined" ? undefined
    : (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Constructor) return null;
  try {
    const contexto = new Constructor();
    void contexto.resume().catch(() => {});
    return { contexto, cerrar: () => { void contexto.close().catch(() => {}); } };
  } catch { return null; }
}

export class EntornoAudio {
  private vivo = true;
  private lease: WakeLockSentinel | null = null;
  private pidiendo = false;
  private limpiarPistas: (() => void)[] = [];
  private medicion: MedicionAudio | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(stream: MediaStream, interrumpir: () => void, private nivel: (nivel: number | null, silencioso: boolean) => void, medicion: MedicionAudio | null) {
    for (const pista of stream.getAudioTracks()) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const unmute = () => { clearTimeout(timeout); timeout = undefined; };
      const mute = () => {
        if (timeout !== undefined) return;
        timeout = setTimeout(() => { timeout = undefined; if (this.vivo && pista.muted) interrumpir(); }, GRACIA_MUTE_MS);
      };
      pista.addEventListener("mute", mute);
      pista.addEventListener("unmute", unmute);
      pista.addEventListener("ended", interrumpir);
      this.limpiarPistas.push(() => {
        unmute(); pista.removeEventListener("mute", mute); pista.removeEventListener("unmute", unmute); pista.removeEventListener("ended", interrumpir);
      });
      if (pista.muted) mute();
    }
    this.analizar(stream, medicion);
    void this.recuperarPantalla();
  }

  async recuperarPantalla() {
    if (!this.vivo || this.pidiendo || document.visibilityState !== "visible" || !navigator.wakeLock || (this.lease && !this.lease.released)) return;
    this.pidiendo = true;
    try {
      const lease = await navigator.wakeLock.request("screen");
      if (!this.vivo) { await lease.release(); return; }
      this.lease = lease;
      lease.addEventListener("release", () => { if (this.lease === lease) this.lease = null; }, { once: true });
    } catch { /* Pantalla encendida best-effort: no cancela una captura válida. */ }
    finally { this.pidiendo = false; }
  }

  private analizar(stream: MediaStream, medicion: MedicionAudio | null) {
    if (!medicion) { this.nivel(null, false); return; }
    try {
      this.medicion = medicion;
      const contexto = medicion.contexto;
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      contexto.createMediaStreamSource(stream).connect(analizador);
      const muestra = new Uint8Array(analizador.fftSize);
      let silencioDesde: number | null = null;
      this.timer = setInterval(() => {
        // Un AudioContext suspendido no mide el micrófono: no inventar silencio
        // y volver a pedirle que arranque, por si el sistema lo suspendió.
        if (contexto.state !== "running") {
          silencioDesde = null;
          this.nivel(null, false);
          if (contexto.state === "suspended") void contexto.resume().catch(() => {});
          return;
        }
        analizador.getByteTimeDomainData(muestra);
        let suma = 0;
        for (const valor of muestra) suma += ((valor - 128) / 128) ** 2;
        const rms = Math.sqrt(suma / muestra.length);
        silencioDesde = rms < UMBRAL_SILENCIO ? silencioDesde ?? performance.now() : null;
        this.nivel(Math.min(1, rms * 6), document.visibilityState === "visible" && silencioDesde !== null && performance.now() - silencioDesde >= AVISO_SILENCIO_MS);
      }, 100);
    } catch {
      medicion.cerrar();
      this.medicion = null;
      this.nivel(null, false);
    }
  }

  cerrar() {
    this.vivo = false;
    this.limpiarPistas.splice(0).forEach(limpiar => limpiar());
    if (this.timer) clearInterval(this.timer);
    this.medicion?.cerrar();
    this.medicion = null;
    const lease = this.lease; this.lease = null;
    if (lease && !lease.released) void lease.release().catch(() => {});
    this.nivel(null, false);
  }
}
