// Qué hace el botón de Recordar cobro según el canal de Tu consultorio.
// Módulo PURO (sin base ni process.env), como src/lib/whatsapp.ts: lo usan
// el servidor (casos-uso/recordar-cobro.ts) y la fila de Cobros, así la
// pantalla y la API no pueden decidir distinto.
//
//   - sms y ambos: el SMS de siempre, que manda el cron. Con `ambos` el
//     recordatorio de turno también sale solo por SMS.
//   - whatsapp: el enlace wa.me con el texto de la plantilla (textoDelCobro);
//     el mensaje sale del teléfono de ella y la app anota que lo abrió.

import type { CanalRecordatorio } from "@/types/domain";

import { enlaceWhatsapp } from "./whatsapp";

export type AccionDeCobro =
  | { canal: "sms" }
  /** `enlace` null: no hay teléfono del que sacar un número. */
  | { canal: "whatsapp"; enlace: string | null };

export function accionDeCobro(canal: CanalRecordatorio, telefono: string, texto: string): AccionDeCobro {
  if (canal !== "whatsapp") return { canal: "sms" };
  return { canal: "whatsapp", enlace: enlaceWhatsapp(telefono, texto) };
}
