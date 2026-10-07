// La firma de Twilio cubre la URL exacta: ¿una redirección de Vercel la rompe?
//
// Diagnóstico de las confirmaciones de SMS (7-oct-2026). Twilio firma el
// StatusCallback contra la URL que le pasamos al enviar (URL_CALLBACK) y la
// ruta valida contra esa misma constante. Si Twilio pegara a una variante
// (www., barra final, http) Vercel la redirige (307/308, medido con curl el
// 7-oct) y, aunque Twilio siguiera la redirección, la firma sería la de la
// variante. Este test fija qué pasa en cada caso con una petición firmada
// como la firma Twilio (el algoritmo está atado al vector oficial en
// firma.test.ts).
//
// Lo que mostró producción: los 6 callbacks de los últimos 7 días llegaron a
// la URL exacta (dominio sesionapp.app, sin 30x en los logs) y dieron 403.
// O sea: no es una redirección.

import { describe, expect, it } from "vitest";

import { firmaTwilio, firmaValida, lineaRechazo, parametrosDeFormulario, URL_CALLBACK } from "@/lib/sms/firma";

const TOKEN = "12345";

/** Un StatusCallback con la forma completa que manda Twilio. */
const CALLBACK_REAL = {
  AccountSid: "AC-otra-cuenta",
  ApiVersion: "2010-04-01",
  From: "+15005550006",
  MessageSid: "SM164ffaa386a9de5241dd2b7324cc02d1",
  MessageStatus: "delivered",
  RawDlrDoneDate: "2610012305",
  SmsSid: "SM164ffaa386a9de5241dd2b7324cc02d1",
  SmsStatus: "delivered",
  To: "+59899123456",
};

/** Lo que llega a la ruta: el cuerpo form-urlencoded, tal cual. */
const cuerpo = new URLSearchParams(CALLBACK_REAL).toString();

describe("la firma de un callback según la URL a la que pegó Twilio", () => {
  it("la URL exacta valida, también después de pasar el cuerpo por el parser de la ruta", () => {
    const firma = firmaTwilio(TOKEN, URL_CALLBACK, CALLBACK_REAL);
    expect(URL_CALLBACK).toBe("https://sesionapp.app/api/sms/callback");
    // El "+" de los teléfonos viaja como %2B y vuelve como "+".
    expect(cuerpo).toContain("To=%2B59899123456");
    expect(firmaValida(TOKEN, URL_CALLBACK, parametrosDeFormulario(cuerpo), firma)).toBe(true);
  });

  it.each([
    ["www.", "https://www.sesionapp.app/api/sms/callback"],
    ["barra final", "https://sesionapp.app/api/sms/callback/"],
    ["http", "http://sesionapp.app/api/sms/callback"],
  ])("una variante (%s) firmada por Twilio no valida contra la URL pública", (_caso, variante) => {
    const firma = firmaTwilio(TOKEN, variante, CALLBACK_REAL);
    expect(firmaValida(TOKEN, URL_CALLBACK, parametrosDeFormulario(cuerpo), firma)).toBe(false);
  });

  it("con otro Auth Token (el secundario, o uno rotado) tampoco valida aunque la URL sea la exacta", () => {
    const firma = firmaTwilio("otro-auth-token", URL_CALLBACK, CALLBACK_REAL);
    expect(firmaValida(TOKEN, URL_CALLBACK, parametrosDeFormulario(cuerpo), firma)).toBe(false);
  });
});

describe("lineaRechazo", () => {
  it("dice si el AccountSid del callback es el nuestro, sin repetirlo", () => {
    const propia = "AC-cuenta-de-prueba";
    const linea = lineaRechazo("firma", { ...CALLBACK_REAL, AccountSid: propia }, propia);
    expect(linea).toBe('[sms-callback] 403 {"motivo":"firma","sid":"SM164ffaa386a9de5241dd2b7324cc02d1","estado":"delivered","cuentaPropia":true}');
    expect(linea).not.toContain(propia);
    expect(lineaRechazo("firma", CALLBACK_REAL, propia)).toContain('"cuentaPropia":false');
    expect(lineaRechazo("sin_token", {})).toBe('[sms-callback] 403 {"motivo":"sin_token"}');
  });
});
