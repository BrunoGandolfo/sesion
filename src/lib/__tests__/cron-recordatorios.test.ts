// GET /api/cron/recordatorios: la ruta, con el despacho y el correo dobles.
//
// La política de envíos la prueban despachar-sms.test.ts contra la base; acá
// sólo lo que es de la ruta: que sin CRON_SECRET no entra nadie, que el
// resumen llega entero y que, si el despacho LANZA (la base no responde),
// sale una alerta crítica y un 503, como en el cron de salud, y no un 500
// que sólo queda en el log.

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { alertar } from "@/lib/alertas";

import { despacharEnvios } from "@/app/api/_lib/casos-uso/despachar-sms";
import { GET } from "@/app/api/cron/recordatorios/route";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/alertas", () => ({ alertar: vi.fn(async () => true) }));
vi.mock("@/app/api/_lib/casos-uso/despachar-sms", () => ({ despacharEnvios: vi.fn() }));

const SECRETO = "secreto-de-cron";
const ENV = {
  CRON_SECRET: SECRETO,
  TWILIO_SMS_FROM: "+59800000000",
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: "token-test",
};

function pedido(autorizacion?: string) {
  return new Request("http://localhost/api/cron/recordatorios", {
    headers: autorizacion ? { authorization: autorizacion } : {},
  });
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.mocked(alertar).mockClear();
  vi.mocked(despacharEnvios).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("sin el secreto del cron no despacha nada", async () => {
  const res = await GET(pedido());
  expect(res.status).toBe(401);
  expect(despacharEnvios).not.toHaveBeenCalled();
});

it("con el secreto despacha y devuelve el resumen, sin alertas si no las hubo", async () => {
  vi.mocked(despacharEnvios).mockResolvedValue({
    procesados: 2,
    aceptados: 2,
    aceptadosTrasCancelacion: 0,
    reintentos: 0,
    fallidos: 0,
    cancelados: 0,
    desconocidos: 0,
    saltados: 0,
    rescatados: 0,
    hayMas: false,
    eventos: [],
    fallosPersistencia: [],
    alertas: [],
  });

  const res = await GET(pedido(`Bearer ${SECRETO}`));

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ procesados: 2, alertas: 0, alertasEnviadas: 0 });
  expect(alertar).not.toHaveBeenCalled();
});

it("si el despacho lanza, alerta como crítico y contesta 503", async () => {
  vi.mocked(despacharEnvios).mockRejectedValue(new Error("Can't reach database server"));

  const res = await GET(pedido(`Bearer ${SECRETO}`));

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "error", alertaEnviada: true });
  expect(alertar).toHaveBeenCalledTimes(1);
  const [nivel, titulo, detalle] = vi.mocked(alertar).mock.calls[0];
  expect(nivel).toBe("critico");
  expect(titulo).toMatch(/SMS/);
  expect(detalle).toMatchObject({ error: "Can't reach database server" });
});
