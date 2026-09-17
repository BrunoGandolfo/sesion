import { LIMITE_SEGUNDOS, SEGMENTO_MS, SOLAPE_MS } from "./contrato";

type Motivo = "manual" | "interrupcion" | "limite";
const INTERVALO_RESPALDO_MS = 1000;
const ESPERA_STOP_MS = 5000;
const DEMORA_MAXIMA_MS = 5000;
// El worker admite 65 s por archivo. Dejamos margen para recibir stop.
const CIERRE_PREVENTIVO_MS = SEGMENTO_MS + 3000;
type Activo = {
  recorder: MediaRecorder; inicio: number; inicioGlobal: number; fin: number;
  blob: Promise<Blob>; chunks: Blob[]; ultimoDato: number; guardado: boolean;
  completar: (incompleto?: boolean) => void; timeout?: ReturnType<typeof setTimeout>;
};
export interface OpcionesCaptura {
  guardar: (blob: Blob, duracionMs: number, inicioMs: number) => Promise<void>;
  respaldar?: (blob: Blob, duracionMs: number, inicioMs: number) => Promise<void>;
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

/** Dos recorders comparten la pista durante el solape. La cola contiene como
 * máximo los cierres en curso; la red nunca forma parte de esta cola. */
export class CapturaAudio {
  private activos: Activo[] = [];
  private pendientes: Activo[] = [];
  private procesando: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;
  private inicio = 0;
  private base = 0;
  private hasta = 0;
  private escritura: Promise<void> = Promise.resolve();
  private ultimoTick = 0;
  private siguiente = 0;
  private reloj: () => number;
  private detenido: Promise<void> | null = null;
  private errorPersistencia = false;
  private motivoPendiente: Motivo | null = null;

  constructor(private opciones: OpcionesCaptura) { this.reloj = opciones.ahora ?? (() => performance.now()); }

  get grabando() { return this.timer !== null; }
  get duracionMs() { return Math.min(LIMITE_SEGUNDOS * 1000, this.base + (this.grabando ? this.reloj() - this.inicio : 0)); }

  iniciar(stream: MediaStream, duracionMs: number) {
    if (this.grabando || this.pendientes.length || this.detenido) throw new Error("Primero hay que guardar los segmentos pendientes");
    if (duracionMs >= LIMITE_SEGUNDOS * 1000) throw new Error("Se alcanzó el límite de 150 minutos");
    this.stream = stream;
    this.base = duracionMs;
    this.hasta = 0;
    this.inicio = this.ultimoTick = this.reloj();
    this.siguiente = SEGMENTO_MS - SOLAPE_MS;
    this.abrir();
    this.timer = setInterval(() => this.tick(), 100);
  }

  /** Respaldo y segmento definitivo se escriben en orden. Un respaldo tardío
   * no puede reaparecer después de consolidar el segmento. */
  private escribir(operacion: () => Promise<void>): Promise<void> {
    const resultado = this.escritura.then(operacion);
    this.escritura = resultado.catch(() => {});
    return resultado;
  }

  private abrir() {
    const recorder = (this.opciones.crearRecorder ?? crearRecorder)(this.stream!);
    const ahora = this.reloj();
    if (!this.activos.length && !this.pendientes.length && this.hasta === 0) this.inicio = this.ultimoTick = ahora;
    const inicio = ahora - this.inicio;
    let resolver!: (blob: Blob) => void;
    let completo = false;
    const activo: Activo = {
      recorder, inicio, inicioGlobal: this.base + inicio, fin: 0, ultimoDato: inicio,
      chunks: [], guardado: false, blob: new Promise(resolve => { resolver = resolve; }),
      completar: (incompleto = false) => {
        if (completo) return;
        completo = true;
        clearTimeout(activo.timeout);
        if (incompleto) {
          // No inventamos los segundos que el navegador no entregó.
          activo.fin = Math.min(activo.fin, activo.ultimoDato);
          this.motivoPendiente = "interrupcion";
          this.opciones.error("El grabador no respondió al detenerse. Se conservó lo recibido; el último tramo puede estar incompleto. Podés reanudar o terminar lo guardado.");
          void this.pausar("interrupcion").catch(() => {});
        }
        resolver(new Blob(activo.chunks, { type: recorder.mimeType }));
        recorder.removeEventListener("dataavailable", datos);
        recorder.removeEventListener("stop", detener);
        recorder.removeEventListener("error", error);
      },
    };
    const datos = (e: BlobEvent) => {
      if (!e.data.size || completo) return;
      activo.chunks.push(e.data);
      activo.ultimoDato = this.reloj() - this.inicio;
      // Basta el prefijo del primer recorder pendiente: durante el solape
      // cubre también al nuevo. El segundo toma su lugar al consolidar el viejo.
      const primero = [...this.pendientes, ...this.activos].find(a => !a.guardado && a.chunks.length);
      if (primero !== activo || !this.opciones.respaldar) return;
      const prefijo = new Blob(activo.chunks, { type: recorder.mimeType });
      const fin = activo.ultimoDato;
      void this.escribir(async () => {
        if (activo.guardado) return;
        await this.opciones.respaldar!(prefijo, Math.max(0, fin - Math.max(this.hasta, inicio)), activo.inicioGlobal);
      }).catch(() => {
        this.errorPersistencia = true;
        this.opciones.error("No se pudo respaldar el audio en este dispositivo. La captura se pausó; mantené esta página abierta y reintentá.");
        void this.pausar("interrupcion").catch(() => {});
      });
    };
    const detener = () => activo.completar();
    const error = () => {
      this.opciones.error("El micrófono interrumpió la captura. El último tramo puede estar incompleto.");
      void this.pausar("interrupcion").catch(() => {});
    };
    recorder.addEventListener("dataavailable", datos);
    recorder.addEventListener("stop", detener, { once: true });
    recorder.addEventListener("error", error, { once: true });
    recorder.start(INTERVALO_RESPALDO_MS);
    this.activos.push(activo);
  }

  private cerrar(activo: Activo, fin = this.reloj() - this.inicio) {
    activo.fin = fin;
    this.pendientes.push(activo);
    activo.timeout = setTimeout(() => activo.completar(true), ESPERA_STOP_MS);
    try { if (activo.recorder.state !== "inactive") activo.recorder.stop(); }
    catch { activo.completar(true); }
  }

  private tick() {
    const ahora = this.reloj();
    const demorado = ahora - this.ultimoTick > DEMORA_MAXIMA_MS;
    this.ultimoTick = ahora;
    const demasiadoLargo = this.activos.some(a => ahora - this.inicio - a.inicio >= CIERRE_PREVENTIVO_MS);
    if (demorado || demasiadoLargo) {
      this.opciones.error("El teléfono demoró la captura. Se pausó para proteger lo guardado; revisá el último tramo antes de reanudar.");
      void this.pausar("interrupcion").catch(() => {});
      return;
    }
    if (this.pendientes.length >= 2 || this.errorPersistencia) { void this.pausar("interrupcion").catch(() => {}); return; }
    if (this.duracionMs >= LIMITE_SEGUNDOS * 1000) { void this.pausar("limite").catch(() => {}); return; }
    const transcurrido = ahora - this.inicio;
    if (transcurrido >= this.siguiente && this.activos.length === 1) {
      try { this.abrir(); } catch { void this.pausar("interrupcion").catch(() => {}); return; }
      this.siguiente = transcurrido + SEGMENTO_MS - SOLAPE_MS;
    }
    if (this.activos.length === 2 && transcurrido - this.activos[1].inicio >= SOLAPE_MS) {
      this.cerrar(this.activos.shift()!);
      void this.drenar().catch(() => { void this.pausar("interrupcion").catch(() => {}); });
    }
  }

  async drenar(): Promise<void> {
    if (this.procesando) return this.procesando;
    this.procesando = (async () => {
      try {
        while (this.pendientes.length) {
          const activo = this.pendientes[0];
          const blob = await activo.blob;
          const duracion = Math.max(0, activo.fin - Math.max(this.hasta, activo.inicio));
          // Al pausar durante el solape, el nuevo puede estar cubierto entero.
          if (activo.fin > activo.inicio) {
            if (!blob.size) {
              this.opciones.error("El micrófono no entregó audio para este tramo. No se pudo recuperar; lo guardado anteriormente se conserva.");
              this.motivoPendiente = "interrupcion";
              // No hay bytes que recuperar ni que descartar. No contamos este
              // hueco como audio ni impedimos reanudar después de avisarlo.
              void this.pausar("interrupcion").catch(() => {});
            } else {
              // Conservamos también el recorder cubierto por el reloj: el
              // anterior podría estar truncado. El worker mide ambos archivos.
              await this.escribir(async () => {
                await this.opciones.guardar(blob, duracion, activo.inicioGlobal);
                activo.guardado = true;
              });
            }
          }
          // Un segmento vacío no cubre al recorder superpuesto: todavía puede
          // recuperar el audio de ese segundo que sí capturó el otro.
          if (blob.size) this.hasta = Math.max(this.hasta, activo.fin);
          activo.guardado = true;
          activo.chunks = [];
          this.pendientes.shift();
        }
        if (this.motivoPendiente) {
          await this.opciones.parada(this.motivoPendiente);
          this.motivoPendiente = null;
        }
        this.errorPersistencia = false;
      } catch {
        this.errorPersistencia = true;
        this.opciones.error("La captura se detuvo porque no se pudo guardar un segmento. Mantené esta página abierta y reintentá.");
        throw new Error("Quedan segmentos por guardar");
      }
    })();
    try { await this.procesando; } finally { this.procesando = null; }
  }

  async pausar(motivo: Motivo = "manual"): Promise<void> {
    if (this.detenido) return this.detenido;
    if (!this.grabando) return this.drenar();
    this.base = this.duracionMs;
    clearInterval(this.timer!);
    this.timer = null;
    const fin = this.reloj() - this.inicio;
    this.motivoPendiente = motivo;
    for (const activo of this.activos) this.cerrar(activo, fin);
    this.activos = [];
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.detenido = (async () => {
      await this.drenar();
    })();
    try { await this.detenido; } finally { this.detenido = null; }
  }
}
