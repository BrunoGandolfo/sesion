// Los números de Lupita que también lee el cupo (ayuda/reservar-cupo.ts).
// Aparte de responder-ayuda.ts para que el cupo no arrastre el corpus ni el
// proveedor; es el mismo arreglo que lux/topes.ts.

/** Cuántas preguntas por usuaria por día. */
export const TOPE_PREGUNTAS_DIA = 40;

export const MENSAJE_TOPE_DIARIO = `Por hoy llegaste a las ${TOPE_PREGUNTAS_DIA} preguntas. Mañana se renueva. Mientras tanto, la ayuda escrita está toda en la app.`;
