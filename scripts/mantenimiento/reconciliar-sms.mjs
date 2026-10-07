#!/usr/bin/env node
// Reconciliar los SMS que se quedaron en `aceptado` con lo que sabe Twilio.
//
// Hasta el arreglo del 7-oct-2026 los StatusCallback de Twilio se
// rechazaban por firma (docs/operaciones.md §6): los envíos quedaron en
// `aceptado` aunque Twilio sabía si se entregaron. Twilio no reenvía
// callbacks pasados. Esto pregunta por cada envío `aceptado` con sid y
// aplica el estado por el MISMO caso de uso que el callback
// (aplicarCallbackTwilio, vía reconciliarEnvios en
// src/app/api/_lib/casos-uso/sms-webhooks.ts).
//
// POR DEFECTO SIMULA: consulta Twilio y muestra qué haría, sin escribir.
// Para escribir hace falta `--aplicar`. Contra producción lo corre el dueño,
// con autorización explícita; nunca un agente.
//
// Uso (las variables vienen del entorno, nunca de la línea de comandos):
//   DATABASE_URL=… TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… \
//     node scripts/mantenimiento/reconciliar-sms.mjs [--aplicar] [--limite N]
//
// Imprime una línea por envío (sid, estado en Twilio, código, efecto) y un
// resumen. No imprime teléfonos, textos ni credenciales.
//
// Carga el TypeScript con jiti (viene con eslint, que es devDependency).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function argumentos(argv) {
  const aplicar = argv.includes("--aplicar");
  const i = argv.indexOf("--limite");
  const limite = i >= 0 ? Number(argv[i + 1]) : 500;
  if (!Number.isInteger(limite) || limite <= 0) throw new Error("--limite tiene que ser un entero positivo");
  return { aplicar, limite };
}

async function main() {
  const { aplicar, limite } = argumentos(process.argv.slice(2));
  for (const nombre of ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) {
    if (!process.env[nombre]) throw new Error(`falta ${nombre} en el entorno`);
  }

  const jiti = createJiti(import.meta.url, { alias: { "@": join(RAIZ, "src") } });
  const { reconciliarEnvios } = await jiti.import(join(RAIZ, "src/app/api/_lib/casos-uso/sms-webhooks.ts"));
  const { consultarMensajeTwilio } = await jiti.import(join(RAIZ, "src/lib/sms/twilio.ts"));

  const prisma = new PrismaClient();
  try {
    const filas = await reconciliarEnvios({
      prisma,
      consultar: (sid) => consultarMensajeTwilio(sid),
      simular: !aplicar,
      ahora: new Date(),
      limite,
    });
    for (const f of filas) {
      console.log(`${f.sid}  twilio=${f.status ?? "?"}  codigo=${f.codigo ?? "-"}  efecto=${f.efecto}  escritos=${f.actualizados}`);
    }
    const cuenta = {};
    for (const f of filas) cuenta[f.efecto] = (cuenta[f.efecto] ?? 0) + 1;
    console.log(`\n${aplicar ? "APLICADO" : "SIMULACIÓN (sin escribir; --aplicar para escribir)"}: ${filas.length} envío(s) ${JSON.stringify(cuenta)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`reconciliar-sms: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
