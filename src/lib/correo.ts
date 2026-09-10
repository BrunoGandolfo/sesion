// Única salida de correo. Sólo la importan rutas Node, nunca auth/middleware.
// API HTTP oficial: https://resend.com/docs/api-reference/emails/send-email
export const REMITENTE_CORREO = "Sesión <no-responder@sesionapp.app>";
export const TIMEOUT_CORREO_MS = 8000;

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export class ErrorCorreo extends Error {
  constructor(public readonly codigo: "sin-clave" | "proveedor" | "red") {
    super(`No se pudo enviar el correo (${codigo}).`);
    this.name = "ErrorCorreo";
  }
}

export async function enviarCorreo(
  correo: Correo,
  opciones: { apiKey?: string; fetcher?: typeof fetch } = {},
): Promise<void> {
  const clave = opciones.apiKey ?? process.env.RESEND_API_KEY;
  if (!clave?.trim()) {
    console.error("[correo] falta RESEND_API_KEY: envío no realizado");
    throw new ErrorCorreo("sin-clave");
  }
  let respuesta: Response;
  try {
    respuesta = await (opciones.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: REMITENTE_CORREO, to: [correo.para], subject: correo.asunto,
        text: correo.texto, html: correo.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_CORREO_MS),
    });
  } catch {
    // Ni el error de red ni el cuerpo del proveedor: pueden traer el enlace.
    console.error("[correo] fallo de red o timeout al enviar");
    throw new ErrorCorreo("red");
  }
  if (!respuesta.ok) {
    console.error("[correo] Resend rechazó el envío; HTTP", respuesta.status);
    throw new ErrorCorreo("proveedor");
  }
}
