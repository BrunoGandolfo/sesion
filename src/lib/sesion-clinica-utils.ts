// MÓDULO DE COMPATIBILIDAD, transitorio. La tabla de transiciones, las keys
// del audio y la regla de huérfanas viven en src/lib/sesion-clinica/estados.ts
// y ahí hay que importarlas. Esto queda SOLO para los importadores que
// todavía no migraron (useSesionClinicaPolling, useGrabacionSesion,
// pacientes/[id]/documentacion, sesiones-sin-contexto) y se borra con ellos.
//
// La nota IA y la nota final ya viajan enteras (`notaIa`, `notaFinal` en
// sesionClinicaResponseSchema): ensamblar secciones sueltas es de la forma
// vieja de la respuesta.

import type { NotaSoap } from "./sesion-clinica/schema";

/** @deprecated Usar `notaIa` / `notaFinal` de la respuesta. Retorna null sólo
 *  si los cuatro campos están ausentes; los faltantes se completan con "". */
export function ensamblarNotaSOAP(campos: {
  subjetivo?: string | null;
  objetivo?: string | null;
  analisis?: string | null;
  plan?: string | null;
}): NotaSoap | null {
  const { subjetivo, objetivo, analisis, plan } = campos;
  if (subjetivo == null && objetivo == null && analisis == null && plan == null) {
    return null;
  }
  return {
    subjetivo: subjetivo ?? "",
    objetivo: objetivo ?? "",
    analisis: analisis ?? "",
    plan: plan ?? "",
  };
}
