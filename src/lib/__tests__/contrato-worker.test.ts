// Lo que la app y el worker comparten en processor/contrato/, del lado de la
// app (revisión del worker, F1 y F2).
//
//   - recorridos-que-la-app-acepta.json: el worker ya no valida la forma del
//     Recorrido, confía en la app. El worker exige no rechazar ninguno
//     (processor/tests/test_recorrido_contrato.py); acá, que
//     contenidoHiloSchema, que es quien decide, los acepte a todos.
//   - politica-trabajos.json: el backoff del borrado del transcript y el lease
//     del worker. La política de la app los lee de ahí; el worker también.
import { describe, expect, it } from "vitest";

import { LEASE_TRABAJO_MS, POLITICA_POR_TIPO } from "@/app/api/_lib/casos-uso/trabajos/politica";
import { contenidoHiloSchema } from "@/lib/hilo/contenido";

import contrato from "../../../processor/contrato/recorridos-que-la-app-acepta.json";
import politica from "../../../processor/contrato/politica-trabajos.json";

describe("Recorridos del contrato con el worker", () => {
  it("el contrato trae casos", () => {
    expect(contrato.casos.length).toBeGreaterThan(0);
  });

  it.each(contrato.casos.map((c) => [c.nombre, c.contenido] as const))("%s", (_nombre, contenido) => {
    const r = contenidoHiloSchema.safeParse(contenido);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues.map((i) => i.path.join(".")))).toBe(true);
  });
});

describe("política de trabajos del contrato", () => {
  it("el backoff del borrado del transcript y el lease del worker son los del contrato", () => {
    expect(POLITICA_POR_TIPO.borrar_transcript_asr.backoffMs).toEqual(
      politica.borrarTranscriptAsr.backoffSeg.map((seg) => seg * 1000),
    );
    expect(LEASE_TRABAJO_MS.worker).toBe(politica.borrarTranscriptAsr.leaseWorkerSeg * 1000);
  });
});
