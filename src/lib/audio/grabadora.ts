import { abrirAlmacen, buscarGrabacion, guardarGrabacion, guardarSegmento, guardarEntrega, recuperarEntregas, retirarCopiasViejas, type GrabacionLocal } from "./almacen";
import { abrirMedicion, EntornoAudio } from "./entorno";
import { CapturaAudio } from "./captura";
import { cifrarSegmento, importarClave } from "./cifrado";
import { LIMITE_SEGUNDOS, MAX_SEGMENTOS } from "./contrato";
import { ErrorAudio, pedirAudio, sincronizarAudio } from "./sincronizar";

export interface VistaGrabadora {
  lista: boolean;
  ocupada: boolean;
  grabacion: GrabacionLocal | null;
  segundos: number;
  /** Una sola línea de estado. Nunca se apila con la anterior. */
  mensaje: string;
  /** Una sola falla, la última. La retira la acción siguiente o un envío que sale bien. */
  error: string | null;
  /** El servidor no tiene esta grabación, o no coincide con la copia local.
   *  En los dos casos hay salida: apartar la copia y liberar el turno. */
  desacuerdo: "ausente" | "conflicto" | null;
  nivelAudio: number | null;
  silencioso: boolean;
}

export const VISTA_INICIAL: VistaGrabadora = { lista: false, ocupada: false, grabacion: null, segundos: 0, mensaje: "", error: null, desacuerdo: null, nivelAudio: null, silencioso: false };

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
  /** Por qué se interrumpió, dicho por quien lo detectó. La pausa lo cuenta
   *  en una sola línea en vez de taparlo con un texto genérico. */
  private razonInterrupcion: string | null = null;
  private vista: VistaGrabadora = VISTA_INICIAL;

  constructor(private cuenta: string, private organizationId: string, private turnoId: string) {
    this.captura = new CapturaAudio({
      // Cada segundo entregado se cifra con el índice de pieza que le tocaría
      // si hubiera que recuperarlo, y se escribe una sola vez.
      entregar: async (trozo, entrega) => {
        const g = this.grabacion!;
        const indice = g.cantidad + entrega.orden;
        if (indice >= MAX_SEGMENTOS) throw new Error("Se alcanzó el máximo de segmentos");
        const cifrado = await cifrarSegmento(trozo, this.clave!, this.organizationId, g.sesionId, indice, indice === 0 ? 0 : entrega.inicioMs);
        await guardarEntrega(this.db!, {
          ...cifrado, continuacion: indice !== 0 && entrega.continuacion,
          cuenta: this.cuenta, sesionId: g.sesionId, base: g.cantidad,
          duracionMs: Math.min(entrega.duracionMs, LIMITE_SEGUNDOS * 1000 - g.duracionMs),
        });
      },
      guardar: async (blob, duracionMs, inicioMs, continuacion) => {
        const g = this.grabacion!;
        if (g.cantidad >= MAX_SEGMENTOS) throw new Error("Se alcanzó el máximo de segmentos");
        const cifrado = await cifrarSegmento(blob, this.clave!, this.organizationId, g.sesionId, g.cantidad, g.cantidad === 0 ? 0 : inicioMs);
        const segmento = { ...cifrado, continuacion: g.cantidad !== 0 && continuacion, cuenta: this.cuenta, sesionId: g.sesionId };
        const siguiente = { ...g, cantidad: g.cantidad + 1, duracionMs: Math.min(LIMITE_SEGUNDOS * 1000, g.duracionMs + duracionMs) };
        await guardarSegmento(this.db!, siguiente, segmento);
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
        const razon = this.razonInterrupcion ?? "La captura se interrumpió.";
        this.razonInterrupcion = null;
        this.avisar(motivo === "interrupcion" ? `${razon} Lo grabado quedó guardado: podés reanudar o enviar lo que hay.`
          : motivo === "limite" ? "Llegaste a 150 minutos. La captura quedó pausada: elegí Terminar para enviarla a procesar."
          : "En pausa. Podés reanudar o enviar lo grabado.");
      },
      error: mensaje => { this.razonInterrupcion = mensaje; this.fallar(mensaje); },
    });
  }

  snapshot = () => this.vista;
  suscribir = (oyente: () => void) => { this.oyentes.add(oyente); return () => this.oyentes.delete(oyente); };

  private publicar(cambio: Partial<VistaGrabadora> = {}) {
    this.vista = { ...this.vista, grabacion: this.grabacion, segundos: (this.captura.grabando ? this.captura.duracionMs : this.grabacion?.duracionMs ?? 0) / 1000, ...cambio };
    this.oyentes.forEach(f => f());
  }
  /** Un aviso reemplaza al anterior y retira la falla que lo precedía. */
  private avisar(mensaje: string) { this.publicar({ mensaje, error: null }); }
  /** Una falla reemplaza al aviso: la pantalla muestra una sola cosa a la vez. */
  private fallar(error: unknown, respaldo = "No se pudo completar la acción") {
    this.publicar({ error: error instanceof Error ? error.message : typeof error === "string" ? error : respaldo, mensaje: "" });
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
        if (await retirarCopiasViejas()) this.avisar("Se retiraron las grabaciones de prueba anteriores, que estaban sin cifrar.");
      } catch (error) { this.fallar(error, "No se pudo retirar la copia de prueba anterior"); }
      this.db = await abrirAlmacen();
      if (this.cancelada) { this.db.close(); return; }
      this.grabacion = await buscarGrabacion(this.db, this.cuenta, this.turnoId) ?? null;
      if (this.cancelada) { this.db.close(); return; }
      if (this.grabacion) {
        const antes = this.grabacion.cantidad;
        this.grabacion = await recuperarEntregas(this.db, this.grabacion);
        if (this.grabacion.cantidad > antes) this.avisar("Se recuperó el audio que había quedado guardado al cerrarse la app.");
      }
      if (this.grabacion?.estado === "capturando") {
        this.grabacion = { ...this.grabacion, estado: "interrumpida", pausas: [...this.grabacion.pausas, { inicio: this.grabacion.duracionMs, fin: null, siguienteIndice: this.grabacion.cantidad, motivo: "interrupcion" }] };
        await guardarGrabacion(this.db, this.grabacion);
        this.avisar("Se recuperó lo guardado. La app se cerró durante la captura, así que el último tramo puede estar incompleto.");
      }
      if (this.cancelada) { this.db.close(); return; }
      this.publicar({ lista: true });
      this.timer = setInterval(() => { this.publicar(); if (performance.now() >= this.siguienteEnvio) void this.enviar(); }, 1000);
      document.addEventListener("visibilitychange", this.visibilidad);
      window.addEventListener("online", this.online);
      if (this.grabacion) void this.enviar();
    } catch (e) { this.fallar(e, "No se pudo abrir la grabación"); }
  }

  private liberarEntorno() { this.entorno?.cerrar(); this.entorno = null; }
  private visibilidad = () => {
    // Ocultar la página no pausa nada. Volver sólo vuelve a pedir la pantalla
    // encendida, que el sistema suelta cada vez que se oculta.
    if (document.visibilityState === "visible" && this.captura.grabando) void this.entorno?.recuperarPantalla();
  };
  private online = () => { this.siguienteEnvio = 0; void this.enviar(); };
  /** Única razón automática para cortar: el micrófono dejó de estar. */
  private interrumpir = () => {
    if (this.captura.grabando) {
      this.liberarEntorno();
      void this.captura.pausar("interrupcion").catch(() => {}).finally(() => this.publicar());
    }
  };

  async iniciar() {
    if (!this.lock || !this.db || this.vista.ocupada || this.captura.grabando) return;
    // Antes de cualquier espera: el navegador sólo deja abrir el audio del
    // dispositivo dentro del gesto que lo pidió. Después del permiso de
    // micrófono ya no hay gesto y el medidor queda suspendido para siempre.
    const medicion = abrirMedicion();
    this.publicar({ ocupada: true, error: null, mensaje: "" });
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
      // El permiso y la escritura local son asíncronos: la pista pudo terminar
      // mientras tanto. Se comprueba lo más tarde posible.
      const pistas = stream.getAudioTracks();
      if (!pistas.length || pistas.some(t => t.readyState === "ended")) {
        throw new Error("El micrófono se interrumpió antes de empezar. Revisalo y reintentá.");
      }
      this.captura.iniciar(stream, g.duracionMs);
      this.entorno = new EntornoAudio(stream, this.interrumpir, (nivelAudio, silencioso) => this.publicar({ nivelAudio, silencioso }), medicion);
      stream = null;
      this.avisar("Grabando. Cada segundo se guarda cifrado y se envía mientras seguís.");
    } catch (e) {
      medicion?.cerrar();
      if (anterior && !this.captura.grabando) {
        this.grabacion = anterior;
        if (inicioPersistido && !this.cancelada) {
          try { await guardarGrabacion(this.db, anterior); }
          catch { /* Si también falla esta escritura, la reapertura la marca interrumpida. */ }
        }
      }
      this.fallar(e, "No se pudo iniciar la captura");
    }
    finally { stream?.getTracks().forEach(t => t.stop()); this.publicar({ ocupada: false }); }
  }

  async pausar(motivo: "manual" | "interrupcion" | "limite" = "manual") {
    if (!this.grabacion || this.vista.ocupada) return;
    this.publicar({ ocupada: true, error: null, mensaje: "" });
    try {
      this.liberarEntorno();
      await this.captura.pausar(motivo);
    } catch (e) { this.fallar(e, "No se pudo guardar la pausa"); }
    finally { this.publicar({ ocupada: false }); }
  }

  /** Cierra la grabación y la envía. Nunca vuelve sin decir qué pasó. */
  async terminar() {
    if (!this.grabacion || this.vista.ocupada) return;
    this.publicar({ ocupada: true, error: null, mensaje: "" });
    try {
      if (this.captura.grabando) {
        this.liberarEntorno();
        await this.captura.pausar();
        this.avisar("Enviando lo grabado…");
      }
      if (!this.grabacion.cantidad) throw new Error("Todavía no hay audio guardado. Grabá unos segundos antes de enviar.");
      if (!["cerrada", "entregada"].includes(this.grabacion.estado)) {
        this.grabacion = { ...this.grabacion, estado: "cerrada" };
        await guardarGrabacion(this.db!, this.grabacion);
      }
      this.clave = null;
      // La subida que arrancó al guardar la última pieza pudo tomar una foto
      // anterior al cierre. Hay que enviar después la foto cerrada.
      await this.sincronizando;
      await this.enviar();
      if (!this.vista.error && this.grabacion.estado !== "entregada") this.avisar("La grabación quedó cerrada y se sigue enviando. Podés dejar la pantalla abierta.");
    } catch (e) { this.fallar(e, "Queda audio pendiente de guardar"); }
    finally { this.publicar({ ocupada: false }); }
  }

  async reintentar(): Promise<void> {
    if (!this.grabacion || this.vista.ocupada || this.cancelada) return;
    this.publicar({ ocupada: true, error: null, mensaje: "" });
    try {
      // Primero se consolida lo que ya está durable: si falló la escritura de
      // una pieza, sus entregas siguen guardadas y se incorporan ahora. La
      // subida sólo conoce piezas; por sí sola no recupera una escritura.
      if (!this.captura.grabando) {
        const antes = this.grabacion.cantidad;
        this.grabacion = await recuperarEntregas(this.db!, this.grabacion);
        if (this.grabacion.cantidad > antes) this.publicar();
      }
      await this.sincronizando;
      await this.enviar();
    } catch (e) {
      this.fallar(e, "Queda audio pendiente de enviar");
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
            this.publicar({ mensaje: "El servidor recibió la grabación. La nota está en camino.", error: null, desacuerdo: null });
          }
        }
        this.intentos = 0;
        this.siguienteEnvio = performance.now() + 15_000;
        if (this.vista.error || this.vista.desacuerdo) this.publicar({ error: null, desacuerdo: null });
      } catch (e) {
        this.siguienteEnvio = performance.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.intentos++, 5));
        this.fallar(e instanceof ErrorAudio ? e : "No pudimos confirmar el envío. La copia cifrada se conserva y se reintentará.");
        if (e instanceof ErrorAudio && e.conflicto) this.publicar({ desacuerdo: "conflicto" });
        else if (e instanceof ErrorAudio && e.status === 404) this.publicar({ desacuerdo: "ausente" });
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
    window.removeEventListener("online", this.online);
    try { await this.captura.pausar("interrupcion"); await this.sincronizando; }
    catch (e) { this.fallar(e, "Queda audio por guardar"); }
    finally { this.clave = null; this.db?.close(); this.cancelarLock?.(); }
  }

  /**
   * Salida cuando el servidor y el teléfono no se ponen de acuerdo. La copia
   * local se conserva entera bajo su identidad original, fuera del índice del
   * turno: no se borra ningún segmento. Después de esto la pantalla vuelve a
   * tener acciones, y el servidor dice dónde está la grabación que sí tiene.
   */
  async apartarCopia() {
    if (!this.grabacion || !this.db || !this.vista.desacuerdo || this.captura.grabando || this.vista.ocupada) return;
    this.publicar({ ocupada: true });
    try {
      await this.sincronizando;
      const g = this.grabacion;
      if (this.vista.desacuerdo === "ausente") {
        // Sólo se libera el índice del turno después de volver a ver el 404.
        try {
          await pedirAudio(`/${g.sesionId}`);
          this.publicar({ desacuerdo: null });
          this.avisar("El servidor volvió a encontrar la grabación. Se reintentará el envío.");
          return;
        } catch (e) { if (!(e instanceof ErrorAudio) || e.status !== 404) throw e; }
      }
      await guardarGrabacion(this.db, { ...g, turnoId: `${this.turnoId}:archivo:${g.sesionId}` });
      this.grabacion = null;
      this.publicar({ desacuerdo: null, error: null, mensaje: "Tu copia quedó guardada aparte, completa. Ahora podés volver a grabar este turno; si el servidor ya tiene audio, te va a decir en qué dispositivo está." });
    } catch (e) {
      this.fallar(e, "No se pudo conservar la copia anterior");
    } finally { this.publicar({ ocupada: false }); }
  }
}
