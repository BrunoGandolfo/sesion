// Los recordatorios por WhatsApp de Hoy, del lado de los datos: la forma
// que manda /api/recordatorios/whatsapp y las dos llamadas. Sin estado, sin
// efectos, sin React.
//
// El texto del mensaje no se arma acá ni en la pantalla: viene armado
// dentro de `enlace` (un wa.me con el texto ya codificado). La pantalla
// sólo lo abre.

import { apiGet, apiPost } from "@/lib/api-client";

/** Cómo se recuerdan los turnos (Tu consultorio). */
export type CanalRecordatorio = "sms" | "whatsapp" | "ambos";

export const CANALES_RECORDATORIO: readonly CanalRecordatorio[] = [
  "sms",
  "whatsapp",
  "ambos",
];

export interface TurnoParaAvisar {
  turnoId: string;
  /** ISO del inicio del turno. */
  fecha: string;
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    telefono: string | null;
  };
  /** null cuando no se puede armar: hoy, sólo si falta el teléfono. */
  enlace: string | null;
  motivo?: "sin_telefono";
  /** ISO de la última vez que ella abrió el WhatsApp de este turno. */
  avisadoEn: string | null;
}

export interface RecordatoriosHoy {
  canal: CanalRecordatorio;
  turnos: TurnoParaAvisar[];
}

/** El bloque sólo existe si ella eligió avisar por WhatsApp. */
export function muestraWhatsapp(canal: CanalRecordatorio): boolean {
  return canal === "whatsapp" || canal === "ambos";
}

export function leerRecordatoriosWhatsapp(
  signal: AbortSignal,
): Promise<RecordatoriosHoy> {
  return apiGet<RecordatoriosHoy>("/api/recordatorios/whatsapp", { signal });
}

/** Registra que ella abrió el WhatsApp del turno. `keepalive`: en el
 *  teléfono, abrir WhatsApp manda la pestaña al fondo y el pedido tiene que
 *  terminar igual. */
export function registrarAbierto(turnoId: string): Promise<{ avisadoEn: string }> {
  return apiPost<{ avisadoEn: string }>(
    `/api/recordatorios/whatsapp/${encodeURIComponent(turnoId)}/abierto`,
    {},
    { keepalive: true },
  );
}
