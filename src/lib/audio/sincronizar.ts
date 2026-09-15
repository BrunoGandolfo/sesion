import { leerSegmento, type GrabacionLocal } from "./almacen";
import type { EstadoAudioRemoto } from "./contrato";

export class ErrorAudio extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function pedirAudio<T>(ruta: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/audio${ruta}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (!response.ok) throw new ErrorAudio(typeof json.error === "string" ? json.error : "No se pudo comprobar el estado del audio", response.status);
  return json.data as T;
}

export async function sincronizarAudio(db: IDBDatabase, grabacion: GrabacionLocal): Promise<EstadoAudioRemoto> {
  const ruta = `/${grabacion.sesionId}`;
  let remoto = await pedirAudio<EstadoAudioRemoto>(ruta);
  for (let indice = 0; indice < grabacion.cantidad; indice++) {
    const local = await leerSegmento(db, grabacion.cuenta, grabacion.sesionId, indice);
    if (!local) throw new ErrorAudio("Falta un segmento local. Se conserva la grabación para revisar.", 409);
    if (!Number.isFinite(local.inicioMs)) throw new ErrorAudio("Esta copia no tiene la medida del inicio. Se conserva para revisar.", 409);
    const recibido = remoto.segmentos[indice];
    if (recibido && (recibido.sha256 !== local.sha256 || recibido.iv !== local.iv || recibido.bytes !== local.bytes || recibido.inicioMs !== local.inicioMs)) throw new ErrorAudio("Hay otro contenido o inicio para este segmento. Se conservan ambas copias.", 409);
    if (recibido?.confirmado) continue;
    if (remoto.estado !== "grabando") throw new ErrorAudio("La sesión cambió y quedan segmentos locales. Se conservan para revisar.", 409);
    const { iv, bytes, sha256, inicioMs } = local;
    const reserva = await pedirAudio<{ confirmado: boolean; url?: string; headers?: Record<string, string> }>(`${ruta}/segmentos`, { indice, iv, bytes, sha256, inicioMs });
    if (reserva.confirmado) continue;
    // Una respuesta perdida del PUT anterior se resuelve con HEAD antes de reenviar.
    let confirmacion = await pedirAudio<{ confirmado: boolean }>(`${ruta}/confirmar`, { indice });
    if (!confirmacion.confirmado) {
      try {
        const put = await fetch(reserva.url!, { method: "PUT", body: local.cifrado, headers: reserva.headers, credentials: "omit", signal: AbortSignal.timeout(30_000) });
        if (!put.ok && put.status !== 412) throw new Error("No se confirmó el envío del segmento");
      } catch {
        // El PUT puede haberse aplicado aunque no haya llegado su respuesta.
      }
      confirmacion = await pedirAudio<{ confirmado: boolean }>(`${ruta}/confirmar`, { indice });
      if (!confirmacion.confirmado) throw new Error("Hay segmentos pendientes de enviar. Se reintentará con conexión.");
    }
  }
  if ((grabacion.estado === "cerrada" || grabacion.estado === "entregada") && ["grabando", "subiendo"].includes(remoto.estado)) {
    remoto = await pedirAudio<EstadoAudioRemoto>(`${ruta}/finalizar`, { cantidad: grabacion.cantidad, duracionAudioSeg: Math.max(1, Math.round(grabacion.duracionMs / 1000)), pausas: grabacion.pausas });
  }
  return remoto;
}
