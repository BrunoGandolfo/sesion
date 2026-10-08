// Los números de Lux que también lee el cupo (ayuda/reservar-cupo.ts). Aparte
// de conversar.ts para que el cupo no arrastre el material ni el proveedor.

/** Cuántas llamadas a Lux por usuaria por día (apertura y preguntas cuentan
 *  igual). Independiente de las 40 de Lupita. */
export const TOPE_LUX_DIA = 60;

export const MENSAJE_TOPE_LUX = `Por hoy llegaste a las ${TOPE_LUX_DIA} consultas a Lux. Mañana se renueva.`;
