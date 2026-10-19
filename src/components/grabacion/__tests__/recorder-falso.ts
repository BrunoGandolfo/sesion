// El doble del MediaRecorder que usan los tests de la grabación. Uno solo:
// si cambia el contrato del recorder (otro evento, otro `state`), se cambia
// acá y no en cada test.
//
// Cada instancia queda en `recorders`, en el orden en que se crearon: una
// grabación es UN recorder, y varios tests lo cuentan. `pause`, `resume` y
// `stop` son vi.fn para poder contar llamadas o hacerlos lanzar. `stop`
// entrega el último trozo y llama a `onstop`, como el de verdad.
//
// Uso: vi.stubGlobal("MediaRecorder", RecorderFalso) y vaciar `recorders`
// en el beforeEach.

import { vi } from "vitest";

export const recorders: RecorderFalso[] = [];

export class RecorderFalso {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn(() => { this.state = "paused"; });
  resume = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; this.emitirChunk(); this.onstop?.(); });
  constructor() { recorders.push(this); }
  static isTypeSupported() { return true; }
  start() { this.state = "recording"; }
  /** Un trozo de audio de `bytes` bytes ("aaaa…"). */
  emitirChunk(bytes = 5) { this.ondataavailable?.({ data: new Blob(["a".repeat(bytes)], { type: "audio/webm" }) }); }
}
