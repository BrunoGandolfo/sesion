import { abrirAlmacen, buscarGrabacion, guardarGrabacion, guardarSegmento, guardarRespaldo, recuperarRespaldo, retirarCopiasViejas, type GrabacionLocal } from "./almacen";
import { EntornoAudio } from "./entorno";
import { CapturaAudio } from "./captura";
import { cifrarSegmento, importarClave } from "./cifrado";
import { LIMITE_SEGUNDOS, MAX_SEGMENTOS } from "./contrato";
import { ErrorAudio, pedirAudio, sincronizarAudio } from "./sincronizar";

export interface VistaGrabadora {
  lista: boolean;
  ocupada: boolean;
  grabacion: GrabacionLocal | null;
  segundos: number;
  mensaje: string;
  error: string | null;
  ausenteRemoto?: boolean;
  nivelAudio: number | null;
  silencioso: boolean;
}

export class Grabadora {
  private db: IDBDatabase | null = null;
  private clave: CryptoKey | null = null;
  private grabacion: GrabacionLocal | null = null;
  private captura: CapturaAudio;
  private entorno: EntornoAudio | null = null;
  private cancelarLock: (() => void) | null = null;
  private sincronizando: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cancelada = false;
  private lock = false;
  private siguienteEnvio = 0;
  private intentos = 0;
  private oyentes = new Set<() => void>();
  private vista: VistaGrabadora = { lista: false, ocupada: false, grabacion: null, segundos: 0, mensaje: "", error: null, nivelAudio: null, silencioso: false };

  constructor(private cuenta: string, private organizationId: string, private turnoId: string) {
    this.captura = new CapturaAudio({
      respaldar: async (blob, duracionMs, inicioMs) => {
        const g = this.grabacion!;
        const segmento = await cifrarSegmento(blob, this.clave!, this.organizationId, g.sesionId, g.cantidad, g.cantidad === 0 ? 0 : inicioMs);
        await guardarRespaldo(this.db!, { ...segmento, cuenta: this.cuenta, sesionId: g.sesionId, duracionMs: Math.min(duracionMs, LIMITE_SEGUNDOS * 1000 - g.duracionMs) });
      },
      guardar: async (blob, duracionMs, inicioMs) => {
        const g = this.grabacion!;
        if (g.cantidad >= MAX_SEGMENTOS) throw new Error("Se alcanzó el máximo de segmentos");
        const segmento = await cifrarSegmento(blob, this.clave!, this.organizationId, g.sesionId, g.cantidad, g.cantidad === 0 ? 0 : inicioMs);
        const siguiente = { ...g, cantidad: g.cantidad + 1, duracionMs: Math.min(LIMITE_SEGUNDOS * 1000, g.duracionMs + duracionMs) };
        await guardarSegmento(this.db!, siguiente, { ...segmento, cuenta: this.cuenta, sesionId: g.sesionId });
        this.grabacion = siguiente;
        this.publicar();
        void this.enviar();
      },
      parada: async motivo => {
        this.liberarEntorno();
        const g = this.grabacion!;
        const siguiente: GrabacionLocal = { ...g, estado: motivo === "interrupcion" ? "interrumpida" : "pausada", pausas: [...g.pausas, { inicio: g.duracionMs, fin: null, siguienteIndice: g.cantidad, motivo }] };
        await guardarGrabacion(this.db!, siguiente);
        this.grabacion = siguiente;
        this.publicar({ mensaje: motivo === "interrupcion" ? "La captura se interrumpió. Este tramo puede estar incompleto; revisá el micrófono antes de reanudar." : motivo === "limite" ? "Llegaste a 150 minutos. La captura quedó pausada: elegí Terminar para enviarla a procesar." : "En pausa" });
      },
      error: error => {
        if (this.grabacion?.estado === "capturando" && !this.captura.grabando) this.grabacion = { ...this.grabacion, estado: "interrumpida" };
        if (!this.captura.grabando) this.liberarEntorno();
        this.publicar({ error });
      },
    });
  }

  snapshot = () => this.vista;
  suscribir = (oyente: () => void) => { this.oyentes.add(oyente); return () => this.oyentes.delete(oyente); };
  private publicar(cambio: Partial<VistaGrabadora> = {}) {
    this.vista = { ...this.vista, grabacion: this.grabacion, segundos: (this.captura.grabando ? this.captura.duracionMs : this.grabacion?.duracionMs ?? 0) / 1000, ...cambio };
    this.oyentes.forEach(f => f());
  }

  async abrir() {
    try {
      if (!navigator.locks) throw new Error("Este navegador no puede impedir dos grabaciones simultáneas. Usá un navegador actualizado.");
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(`audio:${this.organizationId}:${this.turnoId}`, { ifAvailable: true }, async lock => {
          if (!lock) { reject(new Error("Esta grabación está abierta en otra pestaña")); return; }
          this.lock = true;
          await new Promise<void>(liberar => { this.cancelarLock = liberar; resolve(); });
          this.lock = false;
        }).catch(reject);
      });
      if (this.cancelada) { this.cancelarLock?.(); return; }
      try {
        if (await retirarCopiasViejas()) this.publicar({ mensaje: "Se retiraron las grabaciones de prueba anteriores, que estaban sin cifrar." });
      } catch (error) { this.publicar({ mensaje: error instanceof Error ? error.message : "No se pudo retirar la copia de prueba anterior" }); }
      this.db = await abrirAlmacen();
      if (this.cancelada) { this.db.close(); return; }
      this.grabacion = await buscarGrabacion(this.db, this.cuenta, this.turnoId) ?? null;
      if (this.cancelada) { this.db.close(); return; }
      if (this.grabacion) this.grabacion = await recuperarRespaldo(this.db, this.grabacion);
      if (this.grabacion?.estado === "capturando") {
        this.grabacion = { ...this.grabacion, estado: "interrumpida", pausas: [...this.grabacion.pausas, { inicio: this.grabacion.duracionMs, fin: null, siguienteIndice: this.grabacion.cantidad, motivo: "interrupcion" }] };
        await guardarGrabacion(this.db, this.grabacion);
        this.publicar({ mensaje: "Se recuperó lo guardado. El tramo que estaba en captura al cerrarse la app puede estar incompleto." });
      }
      if (this.cancelada) { this.db.close(); return; }
      this.publicar({ lista: true });
      this.timer = setInterval(() => { this.publicar(); if (performance.now() >= this.siguienteEnvio) void this.enviar(); }, 1000);
      document.addEventListener("visibilitychange", this.visibilidad);
      window.addEventListener("pagehide", this.interrumpir);
      window.addEventListener("online", this.online);
      if (this.grabacion) void this.enviar();
    } catch (e) { this.publicar({ error: e instanceof Error ? e.message : "No se pudo abrir la grabación" }); }
  }

  private liberarEntorno() { this.entorno?.cerrar(); this.entorno = null; }
  private visibilidad = () => {
    if (document.visibilityState === "visible" && this.captura.grabando) void this.entorno?.recuperarPantalla();
  };
  private online = () => { this.siguienteEnvio = 0; void this.enviar(); };
  private interrumpir = () => {
    if (this.captura.grabando) {
      this.liberarEntorno();
      // La interrupción del micrófono no espera a que termine una acción de UI.
      void this.captura.pausar("interrupcion").catch(() => {}).finally(() => this.publicar());
    }
  };

  async iniciar() {
    if (!this.lock || !this.db || this.vista.ocupada || this.captura.grabando) return;
    this.publicar({ ocupada: true, error: null });
    let stream: MediaStream | null = null;
    let anterior: GrabacionLocal | null = null;
    let inicioPersistido = false;
    try {
      if (!this.grabacion) {
        const { id } = await pedirAudio<{ id: string }>("", { turnoId: this.turnoId });
        const remoto = await pedirAudio<{ segmentos: unknown[] }>(`/${id}`);
        if (remoto.segmentos.length) throw new Error("Ya existe audio en el servidor para este turno. Volvé al dispositivo que conserva la grabación; no se reemplazó nada.");
        const nueva: GrabacionLocal = { cuenta: this.cuenta, organizationId: this.organizationId, sesionId: id, turnoId: this.turnoId, estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] };
        await guardarGrabacion(this.db, nueva, true);
        this.grabacion = nueva;
      }
      if (["cerrada", "entregada"].includes(this.grabacion.estado)) throw new Error("La grabación ya está cerrada");
      await this.captura.drenar();
      const { clave } = await pedirAudio<{ clave: string }>(`/${this.grabacion.sesionId}/clave`, {});
      this.clave = await importarClave(clave);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (this.cancelada) throw new Error("La pantalla se cerró antes de empezar");
      const g = this.grabacion;
      anterior = g;
      const siguiente: GrabacionLocal = { ...g, estado: "capturando" };
      await guardarGrabacion(this.db, siguiente);
      inicioPersistido = true;
      this.grabacion = siguiente;
      if (this.cancelada) throw new Error("La pantalla se cerró antes de empezar");
      const pistas = stream.getAudioTracks();
      // El permiso y la escritura local son asíncronos: la pista o la página
      // pudieron cambiar antes de que existieran estos oyentes.
      if (!pistas.length || pistas.some(t => t.readyState === "ended")) {
        throw new Error("El micrófono o la pantalla se interrumpieron antes de empezar. Volvé a la app y reintentá.");
      }
      this.captura.iniciar(stream, g.duracionMs);
      this.entorno = new EntornoAudio(stream, this.interrumpir, (nivelAudio, silencioso) => this.publicar({ nivelAudio, silencioso }));
      stream = null;
      this.publicar({ mensaje: "Grabando. Cada segmento se guarda cifrado y se envía mientras seguís." });
    } catch (e) {
      if (anterior && !this.captura.grabando) {
        this.grabacion = anterior;
        if (inicioPersistido && !this.cancelada) {
          try { await guardarGrabacion(this.db, anterior); }
          catch { /* Si también falla esta escritura, la reapertura la marca interrumpida. */ }
        }
      }
      this.publicar({ error: e instanceof Error ? e.message : "No se pudo iniciar la captura" });
    }
    finally { stream?.getTracks().forEach(t => t.stop()); this.publicar({ ocupada: false }); }
  }

  async pausar(motivo: "manual" | "interrupcion" | "limite" = "manual") {
    if (!this.grabacion || this.vista.ocupada) return;
    this.publicar({ ocupada: true });
    try {
      this.liberarEntorno();
      await this.captura.pausar(motivo);
    } catch (e) { this.publicar({ error: e instanceof Error ? e.message : "No se pudo guardar la pausa" }); }
    finally { this.publicar({ ocupada: false }); }
  }

  async terminar() {
    if (!this.grabacion || this.vista.ocupada) return;
    if (this.captura.grabando) {
      await this.pausar();
      // Un stop perdido o una escritura fallida requieren revisar el aviso.
      // No cerrar automáticamente la sesión ni borrar la explicación.
      if (this.vista.error && this.grabacion.estado === "interrumpida") return;
    }
    this.publicar({ ocupada: true, error: null });
    try {
      await this.captura.drenar();
      if (!this.grabacion.cantidad) throw new Error("Todavía no hay audio guardado");
      this.grabacion = { ...this.grabacion, estado: "cerrada" };
      await guardarGrabacion(this.db!, this.grabacion);
      this.clave = null;
      // La subida iniciada al guardar el último segmento puede haber tomado
      // una foto anterior al cierre. Hay que enviar después la foto cerrada.
      await this.sincronizando;
      await this.enviar();
    } catch (e) { this.publicar({ error: e instanceof Error ? e.message : "Queda audio pendiente de guardar" }); }
    finally { this.publicar({ ocupada: false }); }
  }

  async reintentar(): Promise<void> {
    if (!this.grabacion || this.vista.ocupada || this.cancelada) return;
    this.publicar({ ocupada: true, error: null });
    try {
      // Primero vuelve durable lo retenido en memoria. La subida solo conoce
      // lo que ya está en IndexedDB; por sí sola no recupera una escritura.
      await this.captura.drenar();
      await this.sincronizando;
      await this.enviar();
    } catch (e) {
      this.publicar({ error: e instanceof Error ? e.message : "Queda audio pendiente de guardar" });
    } finally { this.publicar({ ocupada: false }); }
  }

  async enviar(): Promise<void> {
    if (this.sincronizando) return this.sincronizando;
    if (!this.grabacion || !this.db || this.cancelada) return;
    const g = this.grabacion;
    this.sincronizando = (async () => {
      try {
        const remoto = await sincronizarAudio(this.db!, g);
        if (g.estado === "cerrada" || g.estado === "entregada") {
          if (remoto.estado !== "grabando" && remoto.estado !== "subiendo") {
            this.grabacion = { ...this.grabacion!, estado: "entregada" };
            await guardarGrabacion(this.db!, this.grabacion);
            this.publicar({ mensaje: "El servidor recibió la grabación. La nota está en camino.", error: null });
          }
        }
        this.intentos = 0;
        this.siguienteEnvio = performance.now() + 15_000;
      } catch (e) {
        this.siguienteEnvio = performance.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.intentos++, 5));
        this.publicar({ error: e instanceof ErrorAudio ? e.message : "No pudimos confirmar el envío. La copia cifrada se conserva y se reintentará." });
        if (e instanceof ErrorAudio && e.status === 404) this.publicar({ ausenteRemoto: true });
        if (e instanceof ErrorAudio && [401, 403, 404, 409].includes(e.status)) this.interrumpir();
      }
    })();
    try { await this.sincronizando; } finally { this.sincronizando = null; }
  }

  async cerrar() {
    this.cancelada = true;
    this.liberarEntorno();
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibilidad);
    window.removeEventListener("pagehide", this.interrumpir);
    window.removeEventListener("online", this.online);
    try { await this.captura.pausar("interrupcion"); await this.sincronizando; }
    catch (e) { this.publicar({ error: e instanceof Error ? e.message : "Queda audio por guardar" }); }
    finally { this.clave = null; this.db?.close(); this.cancelarLock?.(); }
  }

  /** Conserva el registro y sus segmentos bajo su identidad original. Solo
   * libera el índice del turno después de volver a comprobar el 404. */
  async archivarAusente() {
    if (!this.grabacion || !this.db || !this.vista.ausenteRemoto || this.captura.grabando || this.vista.ocupada) return;
    this.publicar({ ocupada: true });
    try {
      await this.sincronizando;
      await this.captura.drenar();
      const g = this.grabacion;
      try { await pedirAudio(`/${g.sesionId}`); this.publicar({ ausenteRemoto: false }); return; }
      catch (e) { if (!(e instanceof ErrorAudio) || e.status !== 404) throw e; }
      await guardarGrabacion(this.db, { ...g, turnoId: `${this.turnoId}:archivo:${g.sesionId}` });
      this.grabacion = null;
      this.publicar({ ausenteRemoto: false, error: null, mensaje: "La copia anterior se conservó. Ahora podés iniciar otra grabación para este turno." });
    } catch (e) {
      this.publicar({ error: e instanceof Error ? e.message : "No se pudo conservar la copia anterior" });
    } finally { this.publicar({ ocupada: false }); }
  }
}
