// Los tipos del grabador: lo que entrega, sus estados y lo que expone a la
// pantalla. Se importan desde GrabadorSesion.tsx, que los reexporta.

import type { PausaRegistrada } from "@/lib/grabacion-cronometro";
import type { DiagnosticoGrabacion, EventoGrabacion } from "@/lib/sesion-clinica/schema";

/** Lo que recibe la pantalla para subir. El Blob se sube tal cual. */
export interface DatosGrabacion {
  audioBlob: Blob;
  /** Segundos de audio recibido, medidos en el teléfono. */
  duracionSegundos: number;
  pausas: PausaRegistrada[];
  diagnostico: DiagnosticoGrabacion;
}

/**
 *   inactivo   → grabando     (iniciar)
 *   grabando   ⇄ pausado      (pausar / reanudar; el tope pausa solo)
 *   grabando/pausado → terminada   (la pista terminó o el recorder falló)
 *   grabando/pausado/terminada → preparando → entregada   (terminar)
 *   inactivo   → preparando → entregada   (enviarPendiente)
 *   cualquiera → inactivo     (descartar / resetear)
 */
export type EstadoGrabador =
  | "inactivo"
  | "grabando"
  | "pausado"
  | "terminada"
  | "preparando"
  | "entregada"
  | "error";

/** Un rato sin audio. `hasta` es null mientras todavía no volvió a llegar. */
export interface AvisoHueco {
  desde: number;
  hasta: number | null;
}

export interface UseGrabadorOpciones {
  /** Con qué se guardan los chunks: el turnoId (turno ↔ sesión es 1:1) o la
   *  clave `sin-turno:…` de una grabación sin turno (lib/grabacion-clave.ts). */
  claveGrabacion: string | null;
  /** Qué grabación guardada en el teléfono ofrecer como pendiente, por su
   *  clave y por el turno que ya se le creó (si se le creó). Sin esto, la de
   *  `claveGrabacion`. Una grabación sin turno no tiene clave conocida al
   *  entrar: se la busca por paciente, o por su turno. */
  esPendiente?: (clave: string, turnoId: string | null, pacienteId: string | null) => boolean;
  /** Se anota con la grabación: la pantalla de esta paciente la encuentra. */
  pacienteId?: string;
  /** Recibe la grabación lista para subir. Una sola vez por grabación. */
  onListo: (datos: DatosGrabacion) => void;
  onError: (mensaje: string) => void;
}

export interface PendienteGuardada {
  clave: string;
  iniciadaEn: number;
  turnoId: string | null;
}

export interface Grabador {
  estado: EstadoGrabador;
  /** Segundos de audio recibido. */
  segundos: number;
  /** 0-1, para el medidor. */
  nivelAudio: number;
  /** El medidor lleva SILENCIO_AVISO_SEG en cero con la pantalla a la vista. */
  audioSilencioso: boolean;
  /** El teléfono silenció el micrófono (una llamada). La grabación sigue. */
  microfonoSilenciado: boolean;
  /** Dejó de llegar audio; queda hasta que ella lo cierra. */
  hueco: AvisoHueco | null;
  limiteAlcanzado: boolean;
  avisoLimite: boolean;
  /** Pausar/Reanudar acaban de tocarse: el botón va deshabilitado. */
  conmutando: boolean;
  mensajeError: string | null;
  /** Se tocó Terminar con menos de MINIMO_SEGUNDOS grabados: no se guardó
   *  nada y se puede volver a grabar. Lo apaga el próximo Grabar. */
  muyCorta: boolean;
  /** Minutos aproximados de una grabación de este turno que quedó guardada. */
  pendienteSeg: number | null;
  /** De esa grabación guardada: con qué clave, cuándo empezó y, si es una
   *  grabación sin turno que ya llegó a crear el suyo, cuál. */
  pendiente: PendienteGuardada | null;
  iniciar: (clave: string) => Promise<void>;
  pausar: () => void;
  reanudar: () => void;
  terminar: () => void;
  descartar: () => void;
  cerrarAvisoHueco: () => void;
  enviarPendiente: () => void;
  descartarPendiente: () => void;
  /** La pantalla anota acá lo que sabe ella: el wake lock. */
  anotar: (tipo: EventoGrabacion["tipo"], ms?: number) => void;
  resetear: () => void;
}
