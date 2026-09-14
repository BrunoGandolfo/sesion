// Unitario — la firma de Twilio, contra los vectores OFICIALES.
//
// Si esto está mal en una dirección el webhook es inútil (403 a todo); en la
// otra, abierto (acepta todo). Por eso los vectores no son inventados:
//
//   1. Documentación de Twilio, "Validating requests":
//      https://www.twilio.com/docs/usage/security#validating-requests
//   2. Suite del SDK oficial twilio-python, tests/unit/test_request_validator.py.

import { describe, expect, it } from "vitest";

import {
  firmaTwilio,
  firmaValida,
  parametrosDeFormulario,
  URL_CALLBACK,
  URL_ENTRANTE,
} from "@/lib/sms/firma";

const TOKEN = "12345";

describe("firmaTwilio — vectores oficiales", () => {
  it("reproduce el ejemplo de la documentación de Twilio", () => {
    const firma = firmaTwilio(TOKEN, "https://example.com/myapp.php?foo=1&bar=2", {
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    });
    expect(firma).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
  });

  it("reproduce el vector del SDK oficial (twilio-python)", () => {
    const firma = firmaTwilio(TOKEN, "https://mycompany.com/myapp.php?foo=1&bar=2", {
      CallSid: "CA1234567890ABCDE",
      Digits: "1234",
      From: "+14158675309",
      To: "+18005551212",
      Caller: "+14158675309",
    });
    expect(firma).toBe("RSOYDt4T1cUTdK1PDd93/VVr8B8=");
  });

  it("ordena los parámetros por clave: el orden de llegada no importa", () => {
    const a = firmaTwilio(TOKEN, "https://x.test/p", { B: "2", A: "1" });
    const b = firmaTwilio(TOKEN, "https://x.test/p", { A: "1", B: "2" });
    expect(a).toBe(b);
  });
});

describe("firmaValida", () => {
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Digits: "1234", From: "+14158675309", To: "+18005551212", Caller: "+14158675309" };

  it("acepta la firma correcta", () => {
    expect(firmaValida(TOKEN, url, params, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(true);
  });

  it("rechaza sin header, con otro token, con otra URL o con un parámetro cambiado", () => {
    expect(firmaValida(TOKEN, url, params, null)).toBe(false);
    expect(firmaValida(TOKEN, url, params, "")).toBe(false);
    expect(firmaValida("otro", url, params, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(false);
    expect(firmaValida(TOKEN, "https://mycompany.com/myapp.php?foo=1", params, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(false);
    expect(firmaValida(TOKEN, url, { ...params, Digits: "9999" }, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(false);
  });

  it("rechaza una firma de distinto largo sin lanzar", () => {
    expect(firmaValida(TOKEN, url, params, "corta")).toBe(false);
  });
});

describe("las URL públicas", () => {
  it("son las del dominio de la app, sin depender de los headers del request", () => {
    expect(URL_CALLBACK).toBe("https://sesionapp.app/api/sms/callback");
    expect(URL_ENTRANTE).toBe("https://sesionapp.app/api/sms/entrante");
  });
});

describe("parametrosDeFormulario", () => {
  it("decodifica x-www-form-urlencoded como lo manda Twilio", () => {
    expect(parametrosDeFormulario("MessageSid=SM1&MessageStatus=delivered&To=%2B59899123456")).toEqual({
      MessageSid: "SM1",
      MessageStatus: "delivered",
      To: "+59899123456",
    });
  });
});
