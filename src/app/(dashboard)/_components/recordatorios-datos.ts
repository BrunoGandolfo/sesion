// Los recordatorios por WhatsApp de Hoy, del lado de los datos: la forma
// que manda /api/recordatorios/whatsapp y las dos llamadas. Sin estado, sin
// efectos, sin React.
//
// El texto del mensaje no se arma acá ni en la pantalla: viene armado
// dentro de `enlace` (un wa.me con el texto ya codificado). La pantalla
// sólo lo abre. Los tipos del contrato viven en src/types/domain.ts, una
// sola vez para la ruta y para la pantalla.

import { apiGet, apiPost } from "@/lib/api-client";
import type {
  AvisoWhatsappRegistrado,
  CanalRecordatorio,
  RecordatorioWhatsapp,
  RecordatoriosWhatsappDeHoy,
} from "@/types/domain";

/** El bloque sólo existe si ella eligió avisar por WhatsApp. */
export function muestraWhatsapp(canal: CanalRecordatorio): boolean {
  return canal === "whatsapp" || canal === "ambos";
}

export function leerRecordatoriosWhatsapp(
  signal: AbortSignal,
): Promise<RecordatoriosWhatsappDeHoy> {
  return apiGet<RecordatoriosWhatsappDeHoy>("/api/recordatorios/whatsapp", { signal });
}

/** Registra que ella abrió el WhatsApp del turno, con la `fecha` del turno
 *  que traía el enlace: si lo movieron entre la lista y el toque, queda
 *  anotado el horario que de verdad se mandó (y la API corrige el aviso
 *  vigente). `keepalive`: en el teléfono, abrir WhatsApp manda la pestaña
 *  al fondo y el pedido tiene que terminar igual. */
export function registrarAbierto(
  turno: Pick<RecordatorioWhatsapp, "turnoId" | "fecha">,
): Promise<AvisoWhatsappRegistrado> {
  return apiPost<AvisoWhatsappRegistrado>(
    `/api/recordatorios/whatsapp/${encodeURIComponent(turno.turnoId)}/abierto`,
    { fecha: turno.fecha },
    { keepalive: true },
  );
}
