// Sólo para la prueba local de pruebas/grabador-ajustes/verificar.mjs.
//
// src/lib/r2.ts arma el endpoint de R2 con el accountId y no se puede apuntar
// a otro lado sin tocar código de producción. Este preload (NODE_OPTIONS=
// --require) hace que el servidor de `next dev` mande a un S3 falso local lo
// que iría a *.r2.cloudflarestorage.com: acá, sólo el HeadObject con que
// upload-confirmar verifica que el audio llegó. Nada sale a Cloudflare.
/* eslint-disable @typescript-eslint/no-require-imports -- un --require tiene que ser CommonJS */
const https = require("node:https");
const http = require("node:http");

const destino = new URL(process.env.R2_FALSO_URL || "http://127.0.0.1:4599");
const original = https.request;

https.request = function requestConR2Falso(opciones, ...resto) {
  const host = typeof opciones === "object" && opciones !== null ? String(opciones.host || opciones.hostname || "") : "";
  if (!host.endsWith(".r2.cloudflarestorage.com")) return original.call(this, opciones, ...resto);
  // El agente que viene es de https: con http no sirve.
  return http.request({ ...opciones, agent: undefined, protocol: "http:", host: destino.hostname, hostname: destino.hostname, port: destino.port }, ...resto);
};
