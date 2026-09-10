import { afterEach, expect, it, vi } from "vitest";
import { enviarCorreo, REMITENTE_CORREO } from "@/lib/correo";
import { plantillaRecuperar } from "@/lib/correo-plantillas";
import { ESLOGAN } from "@/lib/glosario";

const correo = { para: "colega@example.test", ...plantillaRecuperar("https://sesionapp.app/restablecer?token=prueba") };
afterEach(() => vi.restoreAllMocks());
it("envía texto y HTML por HTTP con remitente fijo", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  await enviarCorreo(correo, { apiKey: "clave-de-test", fetcher });
  const [url, opciones] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(JSON.parse(opciones.body)).toEqual({ from: REMITENTE_CORREO, to: [correo.para], subject: correo.asunto, text: correo.texto, html: correo.html });
  expect(opciones.headers.Authorization).toBe("Bearer clave-de-test");
  expect(opciones.signal).toBeInstanceOf(AbortSignal);
});
it("sin clave falla explícitamente sin enviar ni loguear destinatario o token", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi.fn();
  await expect(enviarCorreo(correo, { apiKey: "", fetcher })).rejects.toMatchObject({ codigo: "sin-clave" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).toContain("RESEND_API_KEY");
  expect(JSON.stringify(log.mock.calls)).not.toContain(correo.para);
});
it.each(["red", "proveedor"])("falla de forma segura ante %s", async (codigo) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = codigo === "red" ? vi.fn().mockRejectedValue(new Error("token=secreto"))
    : vi.fn().mockResolvedValue(new Response("token=secreto", { status: 403 }));
  await expect(enviarCorreo(correo, { apiKey: "test", fetcher })).rejects.toMatchObject({ codigo });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
});
it("escapa HTML y conserva el enlace en texto plano", () => {
  const enlace = 'https://sesionapp.app/restablecer?token=a&otro="<b>';
  const plantilla = plantillaRecuperar(enlace);
  expect(plantilla.texto).toContain(enlace);
  expect(plantilla.texto).toContain(`Sesión · ${ESLOGAN}`);
  expect(plantilla.html).toContain(`Sesión · ${ESLOGAN}`);
  expect(plantilla.texto).not.toContain("Tu consultorio, en orden.");
  expect(plantilla.html).not.toContain("Tu consultorio, en orden.");
  expect(plantilla.html).toContain("&amp;otro=&quot;&lt;b&gt;");
  expect(() => plantillaRecuperar("javascript:alert(1)")).toThrow();
});
