import { format } from "date-fns";
import { es } from "date-fns/locale";

export interface WhatsAppMessage {
  to: string;
  text: string;
}

export interface WhatsAppResult {
  success: boolean;
  error?: string;
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<WhatsAppResult> {
  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiKey = process.env.WHATSAPP_API_KEY;
  const instance = process.env.WHATSAPP_INSTANCE;

  if (!apiUrl || !apiKey || !instance) {
    return { success: false, error: "WhatsApp no configurado" };
  }

  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/message/sendText/${instance}`,
      {
        method: "POST",
        headers: {
          apikey: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: message.to,
          text: message.text,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        success: false,
        error: `Evolution API ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      };
    }

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Fallo de red: ${msg}` };
  }
}

export function buildReminderMessage(
  template: string,
  data: {
    nombre: string;
    apellido: string;
    fecha: Date;
    direccion: string;
    profesional: string;
  },
): string {
  const fechaFmt = format(data.fecha, "EEEE d 'de' MMMM", { locale: es });
  const horaFmt = format(data.fecha, "HH:mm");

  return template
    .replaceAll("{{nombre}}", data.nombre)
    .replaceAll("{{apellido}}", data.apellido)
    .replaceAll("{{fecha}}", fechaFmt)
    .replaceAll("{{hora}}", horaFmt)
    .replaceAll("{{direccion}}", data.direccion)
    .replaceAll("{{profesional}}", data.profesional);
}
