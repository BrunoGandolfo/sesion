// El diagnóstico del grabador: viaja con upload-confirmar y queda en
// eventos_auditoria.detalle. Sin contenido clínico: horas, motivos y conteos.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { uploadConfirmarSchema, uploadUrlSchema } from "@/app/api/_lib/schemas";
import { MAX_EVENTOS_GRABACION } from "@/lib/sesion-clinica/schema";

const codigo = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const T = "2026-09-18T13:09:37.000Z";
const cierre = { key: "org/s1/0", duracionAudioSeg: 984 };

test("acepta el diagnóstico: interrupciones con motivo y hora, huecos, visibilidad, wake lock, chunks y bytes", () => {
  const diagnostico = {
    eventos: [
      { t: T, tipo: "wakelock-concedido" },
      { t: T, tipo: "oculta" },
      { t: T, tipo: "wakelock-soltado" },
      { t: T, tipo: "hueco-latido", ms: 509_000 },
      { t: T, tipo: "hueco-chunks", ms: 509_000 },
      { t: T, tipo: "mute" },
      { t: T, tipo: "pista-terminada" },
    ],
    chunks: 984,
    bytes: 15_900_000,
  };
  expect(uploadConfirmarSchema.parse({ ...cierre, diagnostico }).diagnostico).toEqual(diagnostico);
});

test("es opcional: una versión vieja de la app que no lo manda sigue pudiendo confirmar", () => {
  expect(uploadConfirmarSchema.parse(cierre).diagnostico).toBeUndefined();
});

test("no deja pasar texto libre: un evento sólo lleva hora, tipo conocido y milisegundos", () => {
  const con = (evento: Record<string, unknown>) =>
    uploadConfirmarSchema.safeParse({ ...cierre, diagnostico: { eventos: [evento], chunks: 1, bytes: 1 } });

  expect(con({ t: T, tipo: "la paciente dijo algo" }).success).toBe(false);
  expect(con({ t: "ayer", tipo: "mute" }).success).toBe(false);
  const colado = con({ t: T, tipo: "mute", nota: "texto clínico" });
  expect(colado.success && colado.data.diagnostico?.eventos[0]).toEqual({ t: T, tipo: "mute" });
});

test("tiene tope: un teléfono que parpadea no infla la auditoría", () => {
  const eventos = Array.from({ length: MAX_EVENTOS_GRABACION + 1 }, () => ({ t: T, tipo: "oculta" }));
  expect(uploadConfirmarSchema.safeParse({ ...cierre, diagnostico: { eventos, chunks: 1, bytes: 1 } }).success).toBe(false);
});

test("la ruta lo guarda en la auditoría de la subida y no se lo pasa al caso de uso de la sesión", () => {
  const ruta = codigo("src/app/api/sesion-clinica/[id]/upload-confirmar/route.ts");
  expect(ruta).toContain("const { diagnostico, ...cierre } = parsed.data;");
  expect(ruta).toContain("...cierre, almacen: almacenAudio");
  expect(ruta).toMatch(/await auditar\(\{ ok: true,[^}]*diagnostico/);
});

test("upload-url ya no pide IV: el audio no se cifra en la app", () => {
  expect(uploadUrlSchema.parse({ tamanoBytes: 10, mime: "audio/webm" })).toEqual({ tamanoBytes: 10, mime: "audio/webm" });
  expect(Object.keys(uploadUrlSchema.shape)).toEqual(["tamanoBytes", "mime"]);
});
