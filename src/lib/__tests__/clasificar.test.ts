// Unitario — la tabla de códigos de Twilio. Cada fila se verificó contra la
// documentación oficial el 11-09-2026; acá se fija lo que el sistema hace
// con cada una.

import { describe, expect, it } from "vitest";

import { clasificarCallback, clasificarRespuesta } from "@/lib/sms/clasificar";

describe("clasificarRespuesta (POST /Messages.json ≥ 400)", () => {
  it("20003 autenticación: definitivo y crítico (es un secreto mal cargado)", () => {
    const c = clasificarRespuesta(401, 20003);
    expect(c.clase).toBe("definitivo");
    expect(c.alerta).toBe("critico");
    expect(c.referencia).toBe("https://www.twilio.com/docs/api/errors/20003");
  });

  it("20429 y cualquier 429: transitorio con más jitter", () => {
    expect(clasificarRespuesta(429, 20429)).toMatchObject({ clase: "transitorio", jitterMayor: true });
    expect(clasificarRespuesta(429, null)).toMatchObject({ clase: "transitorio", jitterMayor: true });
  });

  it("21211 To inválido: definitivo, con motivo en castellano", () => {
    expect(clasificarRespuesta(400, 21211)).toMatchObject({
      clase: "definitivo",
      motivoNoEnvio: "el teléfono no es válido",
    });
  });

  it("21214 y 21614: el número no se alcanza o no es celular, definitivo", () => {
    expect(clasificarRespuesta(400, 21214).clase).toBe("definitivo");
    expect(clasificarRespuesta(400, 21614)).toMatchObject({ clase: "definitivo", motivoNoEnvio: "el teléfono no es un celular" });
  });

  it("21212, 21606 From mal configurado y 21408 región: definitivo y crítico", () => {
    for (const codigo of [21212, 21606, 21408]) {
      expect(clasificarRespuesta(400, codigo)).toMatchObject({ clase: "definitivo", alerta: "critico" });
    }
  });

  it("21610 dado de baja: definitivo y crea la baja con motivo twilio_21610", () => {
    expect(clasificarRespuesta(400, 21610)).toMatchObject({
      clase: "definitivo",
      baja: "twilio_21610",
      motivoNoEnvio: "la paciente pidió no recibir más mensajes",
    });
  });

  it("30001 cola desbordada: transitorio; 30002 cuenta suspendida: transitorio y crítico", () => {
    expect(clasificarRespuesta(400, 30001)).toMatchObject({ clase: "transitorio" });
    expect(clasificarRespuesta(400, 30002)).toMatchObject({ clase: "transitorio", alerta: "critico" });
  });

  it("5xx: transitorio", () => {
    expect(clasificarRespuesta(503, null).clase).toBe("transitorio");
  });

  it("un 4xx no listado: definitivo, con el código en el motivo", () => {
    const c = clasificarRespuesta(400, 21999);
    expect(c.clase).toBe("definitivo");
    expect(c.motivoNoEnvio).toContain("21999");
    expect(c.referencia).toBe("https://www.twilio.com/docs/api/errors/21999");
    expect(clasificarRespuesta(400, null).clase).toBe("definitivo");
  });

  it("toda fila lleva su referencia a la documentación", () => {
    for (const codigo of [20003, 20429, 21211, 21212, 21214, 21408, 21606, 21610, 21614, 30001, 30002]) {
      expect(clasificarRespuesta(400, codigo).referencia).toMatch(/^https:\/\/www\.twilio\.com\/docs\//);
    }
  });
});

describe("clasificarCallback (StatusCallback)", () => {
  it("delivered → entregado", () => {
    expect(clasificarCallback("delivered", null)).toEqual({ efecto: "entregado" });
  });

  it("undelivered / failed → no_entregado con el motivo del código", () => {
    expect(clasificarCallback("undelivered", 30003)).toMatchObject({ efecto: "no_entregado", motivoNoEnvio: "el teléfono estaba apagado o sin señal" });
    expect(clasificarCallback("failed", 30005)).toMatchObject({ efecto: "no_entregado" });
    expect(clasificarCallback("undelivered", 30006)).toMatchObject({ efecto: "no_entregado" });
  });

  it("30007 filtrado por el operador: no_entregado y aviso (el contenido está bloqueado)", () => {
    expect(clasificarCallback("undelivered", 30007)).toMatchObject({ efecto: "no_entregado", alerta: "aviso" });
  });

  it("un código desconocido igual cierra como no_entregado y lo nombra", () => {
    expect(clasificarCallback("failed", 30999)).toMatchObject({ efecto: "no_entregado", motivoNoEnvio: "el operador no lo entregó (30999)" });
    expect(clasificarCallback("failed", null)).toMatchObject({ efecto: "no_entregado", motivoNoEnvio: "el operador no lo entregó" });
  });

  it("queued / sending / sent son intermedios: no cambian nada", () => {
    for (const estado of ["queued", "sending", "sent", "accepted", "cualquier-cosa"]) {
      expect(clasificarCallback(estado, null)).toEqual({ efecto: "ignorar" });
    }
  });
});
