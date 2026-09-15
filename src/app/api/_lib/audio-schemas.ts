import { z } from "zod";
import { pausaMedidaSchema } from "@/lib/sesion-clinica/schema";
import { LIMITE_SEGUNDOS, MAX_BYTES_SEGMENTO, MAX_SEGMENTOS } from "@/lib/audio/contrato";
export const prepararAudioSchema = z.object({ turnoId: z.uuid() }).strict();
export const indiceAudioSchema = z.object({ indice: z.int().min(0).max(MAX_SEGMENTOS - 1) }).strict();
export const segmentoAudioSchema = indiceAudioSchema.extend({
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  bytes: z.int().min(17).max(MAX_BYTES_SEGMENTO),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  inicioMs: z.number().finite().min(0).max(LIMITE_SEGUNDOS * 1000),
}).strict().refine(s => s.indice !== 0 || s.inicioMs === 0, { path: ["inicioMs"], message: "El primer segmento empieza en cero" });
export const finalizarAudioSchema = z.object({
  cantidad: z.int().min(1).max(MAX_SEGMENTOS),
  duracionAudioSeg: z.int().min(1).max(LIMITE_SEGUNDOS),
  pausas: z.array(pausaMedidaSchema).max(MAX_SEGMENTOS),
}).strict().superRefine((cierre, ctx) => {
  for (const [i, pausa] of cierre.pausas.entries()) {
    if (pausa.siguienteIndice > cierre.cantidad || (i > 0 && pausa.siguienteIndice < cierre.pausas[i - 1].siguienteIndice) || pausa.inicio > LIMITE_SEGUNDOS * 1000 || (pausa.fin !== null && pausa.fin < pausa.inicio)) {
      ctx.addIssue({ code: "custom", path: ["pausas", i], message: "La pausa no corresponde a esta grabación" });
    }
  }
});
