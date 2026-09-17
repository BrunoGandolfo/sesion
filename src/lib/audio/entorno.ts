/** Protecciones recuperadas del grabador anterior (ea5ce74^).
 * Son independientes de los segmentos: nunca deciden por visibilidad ni por
 * silencio si hay que cerrar una sesión. */
const GRACIA_MUTE_MS = 3000;
const UMBRAL_SILENCIO = 0.012;
const AVISO_SILENCIO_MS = 120_000;

export class EntornoAudio {
  private vivo = true;
  private lease: WakeLockSentinel | null = null;
  private pidiendo = false;
  private limpiarPistas: (() => void)[] = [];
  private contexto: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(stream: MediaStream, interrumpir: () => void, private nivel: (nivel: number | null, silencioso: boolean) => void) {
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
    this.analizar(stream);
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

  private analizar(stream: MediaStream) {
    const Constructor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    try {
      const contexto = this.contexto = new Constructor();
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 512;
      contexto.createMediaStreamSource(stream).connect(analizador);
      const muestra = new Uint8Array(analizador.fftSize);
      let silencioDesde: number | null = null;
      void contexto.resume().catch(() => {});
      this.timer = setInterval(() => {
        // Un AudioContext suspendido no mide el micrófono: no inventar silencio.
        if (contexto.state !== "running") { silencioDesde = null; this.nivel(null, false); return; }
        analizador.getByteTimeDomainData(muestra);
        let suma = 0;
        for (const valor of muestra) suma += ((valor - 128) / 128) ** 2;
        const rms = Math.sqrt(suma / muestra.length);
        silencioDesde = rms < UMBRAL_SILENCIO ? silencioDesde ?? performance.now() : null;
        this.nivel(Math.min(1, rms * 6), document.visibilityState === "visible" && silencioDesde !== null && performance.now() - silencioDesde >= AVISO_SILENCIO_MS);
      }, 100);
    } catch {
      void this.contexto?.close().catch(() => {});
      this.contexto = null;
      this.nivel(null, false);
    }
  }

  cerrar() {
    this.vivo = false;
    this.limpiarPistas.splice(0).forEach(limpiar => limpiar());
    if (this.timer) clearInterval(this.timer);
    void this.contexto?.close().catch(() => {});
    this.contexto = null;
    const lease = this.lease; this.lease = null;
    if (lease && !lease.released) void lease.release().catch(() => {});
    this.nivel(null, false);
  }
}
