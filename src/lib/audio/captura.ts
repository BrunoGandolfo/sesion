import { ENTREGA_MS, LIMITE_SEGUNDOS, SEGMENTO_MS, SIN_AUDIO_MS } from "./contrato";

type Motivo = "manual" | "interrupcion" | "limite";
/** Cuánto se espera al `stop` antes de cerrar con lo que ya se entregó. No se
 *  pierde nada: cada entrega ya está cifrada y guardada. */
const ESPERA_STOP_MS = 5_000;
const TICK_MS = 1_000;
/** Tope de lo que un solo tick puede sumar al reloj de silencio. Si la página
 *  estuvo congelada, ese tiempo no lo vivió nadie y no prueba nada sobre el
 *  micrófono. */
const TICK_MAXIMO_MS = 2_000;

export interface EntregaCaptura {
  /** Posición de la entrega dentro de la pieza en curso. */
  orden: number;
  inicioMs: number;
  duracionMs: number;
  continuacion: boolean;
}

export interface OpcionesCaptura {
  /** Un trozo de un segundo, tal como lo entregó el navegador. Se guarda
   *  cifrado enseguida; es lo único que sobrevive a una muerte del proceso. */
  entregar: (trozo: Blob, entrega: EntregaCaptura) => Promise<void>;
  /** La pieza completa: todas las entregas acumuladas desde el último corte. */
  guardar: (blob: Blob, duracionMs: number, inicioMs: number, continuacion: boolean) => Promise<void>;
  parada: (motivo: Motivo) => Promise<void>;
  error: (mensaje: string) => void;
  ahora?: () => number;
  crearRecorder?: (stream: MediaStream) => MediaRecorder;
}

export function crearRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m));
  if (!mimeType) throw new Error("Este navegador no permite grabar Opus ni AAC");
  return new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
}

/**
 * Un solo MediaRecorder por corrida, pidiendo audio cada segundo.
 *
 * No hay rotación, no hay dos recorders, no hay solape: el corte de una pieza
 * ocurre en el acumulador, entre dos entregas, sin tocar el recorder. Por eso
 * una página congelada no pierde audio ni necesita que ningún temporizador
 * llegue a horario: el navegador sigue grabando y entrega lo pendiente al
 * despertar.
 *
 * Lo único que este objeto decide solo es interrumpir, y sólo con una prueba:
 * que no llegó una entrega en SIN_AUDIO_MS de página viva.
 */
export class CapturaAudio {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private mimeType = "audio/webm";
  /** Acumulador en claro de la pieza en curso. Nunca se escribe así en disco. */
  private trozos: Blob[] = [];
  private orden = 0;
  /** La pieza en curso continúa el archivo de la anterior. */
  private continuacion = false;
  /** Milisegundos ya grabados antes de esta corrida. Fijo mientras dura. */
  private base = 0;
  /** Total grabado cuando no hay corrida en curso. */
  private total = 0;
  /** Reloj al arrancar la corrida. */
  private inicio = 0;
  /** Dónde arranca la pieza en curso, relativo a la corrida. */
  private desde = 0;
  /** Hasta dónde cubren las entregas ya recibidas, relativo a la corrida. */
  private hasta = 0;
  private sinAudioMs = 0;
  private ultimoTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private escritura: Promise<void> = Promise.resolve();
  private cerrando: Promise<void> | null = null;
  /** Se levanta antes de pedir el `stop`: la entrega final llega enseguida y
   *  no tiene que abrir una pieza nueva. */
  private pausando = false;
  private reloj: () => number;

  constructor(private opciones: OpcionesCaptura) { this.reloj = opciones.ahora ?? (() => performance.now()); }

  get grabando() { return this.recorder !== null; }
  get duracionMs() { return Math.min(LIMITE_SEGUNDOS * 1000, this.grabando ? this.base + this.reloj() - this.inicio : this.total); }

  iniciar(stream: MediaStream, duracionMs: number) {
    if (this.grabando || this.cerrando) throw new Error("La captura anterior todavía se está guardando");
    if (duracionMs >= LIMITE_SEGUNDOS * 1000) throw new Error("Se alcanzó el límite de 150 minutos");
    const recorder = (this.opciones.crearRecorder ?? crearRecorder)(stream);
    this.stream = stream;
    this.mimeType = recorder.mimeType || "audio/webm";
    this.base = this.total = duracionMs;
    this.inicio = this.ultimoTick = this.reloj();
    this.trozos = [];
    this.orden = 0;
    this.continuacion = false;
    this.desde = this.hasta = 0;
    this.sinAudioMs = 0;
    let vivo = true;
    const datos = (e: BlobEvent) => { if (vivo && e.data.size) this.recibir(e.data); };
    recorder.addEventListener("dataavailable", datos);
    recorder.addEventListener("error", () => {
      if (!vivo) return;
      this.opciones.error("El micrófono interrumpió la captura. Se guardó todo lo que había entregado hasta ahora.");
      void this.pausar("interrupcion").catch(() => {});
    }, { once: true });
    this.cortar = () => { vivo = false; recorder.removeEventListener("dataavailable", datos); };
    recorder.start(ENTREGA_MS);
    this.recorder = recorder;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Desconecta los oyentes de la corrida en curso. La reemplaza `iniciar`. */
  private cortar: () => void = () => {};

  /** Las escrituras van en orden: una entrega tardía no puede aparecer después
   *  del cierre de su pieza, que es el que la retira. */
  private escribir(operacion: () => Promise<void>): Promise<void> {
    const resultado = this.escritura.then(operacion);
    this.escritura = resultado.catch(() => {});
    return resultado;
  }

  private recibir(trozo: Blob) {
    const t = this.reloj() - this.inicio;
    const orden = this.orden++;
    const cubierto = this.hasta;
    this.sinAudioMs = 0;
    this.trozos.push(trozo);
    const entrega: EntregaCaptura = {
      orden,
      inicioMs: this.base + cubierto,
      duracionMs: Math.max(0, t - cubierto),
      // La primera entrega de la pieza hereda su condición; de ahí en más son
      // continuación, porque ninguna trae la cabecera del contenedor.
      continuacion: orden === 0 ? this.continuacion : true,
    };
    this.hasta = Math.max(cubierto, t);
    void this.escribir(() => this.opciones.entregar(trozo, entrega)).catch(() => {
      this.opciones.error("No se pudo guardar el audio en este dispositivo. La captura se pausó; mantené esta página abierta y reintentá.");
      void this.pausar("interrupcion").catch(() => {});
    });
    // Durante una pausa no se corta: la entrega final del `stop` pertenece a
    // la pieza que se está cerrando, no a una pieza nueva de duración cero.
    if (!this.pausando && this.hasta - this.desde >= SEGMENTO_MS) void this.escribir(() => this.cerrarPieza(this.hasta)).catch(() => {});
  }

  /** Cierra la pieza en curso con lo acumulado. Vacía el acumulador aunque la
   *  escritura falle: los trozos ya están guardados uno por uno. */
  private async cerrarPieza(fin: number): Promise<void> {
    const trozos = this.trozos;
    const desde = this.desde;
    const continuacion = this.continuacion;
    this.trozos = [];
    this.orden = 0;
    this.desde = this.hasta = Math.max(fin, desde);
    this.continuacion = true;
    if (!trozos.length) return;
    await this.opciones.guardar(new Blob(trozos, { type: this.mimeType }), Math.max(0, this.desde - desde), this.base + desde, continuacion);
  }

  private tick() {
    const ahora = this.reloj();
    // Sólo cuenta el tiempo que esta página estuvo viva. Un congelamiento no
    // es prueba de que el micrófono haya dejado de entregar.
    this.sinAudioMs += Math.min(ahora - this.ultimoTick, TICK_MAXIMO_MS);
    this.ultimoTick = ahora;
    if (this.sinAudioMs >= SIN_AUDIO_MS) {
      this.opciones.error("Hace un minuto que no entra sonido. La captura se pausó para que revises el micrófono; lo grabado se conserva.");
      void this.pausar("interrupcion").catch(() => {});
      return;
    }
    if (this.duracionMs >= LIMITE_SEGUNDOS * 1000) void this.pausar("limite").catch(() => {});
  }

  /** Detiene la corrida, cierra su última pieza y avisa el motivo. Siempre
   *  termina: si `stop` no llega, cierra con lo entregado. */
  async pausar(motivo: Motivo = "manual"): Promise<void> {
    if (this.cerrando) return this.cerrando;
    const recorder = this.recorder;
    if (!recorder) { await this.escritura; return; }
    this.total = Math.min(LIMITE_SEGUNDOS * 1000, this.base + (this.reloj() - this.inicio));
    this.pausando = true;
    this.recorder = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.cerrando = (async () => {
      await this.esperarStop(recorder);
      this.cortar();
      this.stream?.getTracks().forEach(t => t.stop());
      this.stream = null;
      // Si la escritura de la pieza falla, la captura igual se detuvo: el
      // estado tiene que decirlo. El audio no se pierde —sus entregas siguen
      // guardadas— y Reintentar las consolida.
      let fallo: unknown = null;
      try { await this.escribir(() => this.cerrarPieza(this.hasta)); }
      catch (e) { fallo = e; }
      await this.opciones.parada(motivo);
      if (fallo) throw fallo;
    })();
    try { await this.cerrando; } finally { this.cerrando = null; this.pausando = false; }
  }

  private esperarStop(recorder: MediaRecorder): Promise<void> {
    return new Promise<void>(resolve => {
      let listo = false;
      const terminar = () => { if (listo) return; listo = true; clearTimeout(espera); resolve(); };
      const espera = setTimeout(() => {
        this.opciones.error("El grabador no respondió al detenerse. Se conservó todo lo que había entregado hasta ese momento.");
        terminar();
      }, ESPERA_STOP_MS);
      recorder.addEventListener("stop", terminar, { once: true });
      try { if (recorder.state === "inactive") terminar(); else recorder.stop(); }
      catch { terminar(); }
    });
  }
}
